#![no_std]

//! # Sub Rosa — Round
//!
//! A reusable Soroban primitive for confidential commit → verifiable-reveal →
//! on-chain-settle coordination rounds. Bids are sealed with Drand timelock
//! encryption until a future round R that nobody controls; round R's threshold
//! signature is verified on-chain (BLS12-381) to force a simultaneous reveal.
//! The protocol — not the operator — owns fairness.
//!
//! No mocks, no fallbacks: every gate is a real on-chain check.

mod drand;
mod payload;
mod storage;
mod types;

use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Bytes, BytesN, Env, Vec,
};

use storage::*;
use types::*;

const MAX_CIPHERTEXT: u32 = 4096;
const MAX_AUDITOR_BLOB: u32 = 2048;
const MAX_AUDITOR_PUBKEY: u32 = 1024;
/// Cap on distinct bidders per round so the persisted bidder index stays well
/// within the contract data-entry size ceiling (PRD §8).
const MAX_BIDDERS: u32 = 500;
/// Grace window (seconds) after the reveal deadline before a stuck round
/// (e.g. Drand never produced R) can be voided and all escrow refunded.
const VOID_GRACE: u64 = 3600;
/// Maximum page size for paginated getters. Prevents resource exhaustion.
const MAX_PAGE_SIZE: u32 = 100;
/// Core v2 deliberately caps cohorts so clear/refund/settlement remain within
/// a measured, reviewable resource envelope until claim-based settlement ships.
const MAX_V2_PARTICIPANTS: u32 = 25;
const MAX_ROUND_DURATION_SECS: u64 = 30 * 24 * 60 * 60;
const CORE_V2_VERSION: u32 = 2;
const REVEAL_POLICY_VERSION: u32 = 3;
const MIN_REVEAL_WINDOW: u64 = 300;

#[contract]
pub struct SubRosaRound;

#[allow(clippy::too_many_arguments)]
fn create_round_v2_impl(
    env: &Env,
    operator: Address,
    item_ref: BytesN<32>,
    schema_ref: BytesN<32>,
    settlement: SettlementConfig,
    reveal_round: u64,
    clearing_rule: ClearingRule,
    commit_deadline: u64,
    reveal_deadline: u64,
    auditor_pubkey: Bytes,
    max_participants: u32,
    policy: Option<RoundPolicyV2>,
) -> Result<u64, Error> {
    operator.require_auth();
    let SettlementConfig {
        mode,
        payment_asset,
        lot_asset,
        lot_amount,
    } = settlement;
    let config = get_config(env)?;
    bump_instance(env);

    if reveal_round == 0 {
        return Err(Error::InvalidAmount);
    }
    if max_participants == 0 || max_participants > MAX_V2_PARTICIPANTS {
        return Err(Error::InvalidLimit);
    }
    if auditor_pubkey.len() > MAX_AUDITOR_PUBKEY {
        return Err(Error::PayloadTooLarge);
    }

    let now = env.ledger().timestamp();
    let t_reveal = drand::time_of_round(&config, reveal_round);
    if commit_deadline >= t_reveal || reveal_deadline <= t_reveal {
        return Err(Error::CommitDeadlineAfterReveal);
    }
    if commit_deadline <= now {
        return Err(Error::DeadlineInPast);
    }
    if reveal_deadline.saturating_sub(now) > MAX_ROUND_DURATION_SECS {
        return Err(Error::RoundDurationTooLong);
    }

    match mode {
        RoundMode::Auction => {
            if payment_asset.is_none() || lot_asset.is_none() || lot_amount <= 0 {
                return Err(Error::InvalidAmount);
            }
        }
        RoundMode::ReceiptOnly => {
            if payment_asset.is_some() || lot_asset.is_some() || lot_amount != 0 {
                return Err(Error::EscrowNotAllowed);
            }
        }
    }

    if let Some(ref partner_policy) = policy {
        match mode {
            RoundMode::Auction if partner_policy.fixed_escrow <= 0 => {
                return Err(Error::InvalidAmount);
            }
            RoundMode::ReceiptOnly if partner_policy.fixed_escrow != 0 => {
                return Err(Error::EscrowNotAllowed);
            }
            _ => {}
        }
        if partner_policy.eligible_participants.len() > max_participants {
            return Err(Error::InvalidLimit);
        }
        for left in 0..partner_policy.eligible_participants.len() {
            for right in (left + 1)..partner_policy.eligible_participants.len() {
                if partner_policy.eligible_participants.get(left)
                    == partner_policy.eligible_participants.get(right)
                {
                    return Err(Error::InvalidLimit);
                }
            }
        }
    }

    if let Some(asset) = lot_asset.clone() {
        token::Client::new(env, &asset).transfer(
            &operator,
            &env.current_contract_address(),
            &lot_amount,
        );
    }

    let round_id = next_round_id(env);
    let round = RoundV2 {
        protocol_version: CORE_V2_VERSION,
        schema_ref,
        mode,
        operator: operator.clone(),
        item_ref,
        payment_asset,
        lot_asset,
        lot_amount,
        reveal_round,
        clearing_rule,
        commit_deadline,
        reveal_deadline,
        auditor_pubkey,
        max_participants,
        status: Status::Open,
        bidders: Vec::new(env),
        winner: None,
        winning_bid: 0,
    };
    set_round_v2(env, round_id, &round);
    if let Some(partner_policy) = policy {
        set_round_policy_v2(env, round_id, &partner_policy);
    }
    env.events().publish(
        (symbol_short!("createdv2"), round_id),
        (operator, mode, reveal_round, commit_deadline),
    );
    Ok(round_id)
}

#[contractimpl]
impl SubRosaRound {
    /// One-time deploy configuration. All Drand parameters are supplied by the
    /// deployer from values validated against a live quicknet round.
    pub fn __constructor(
        env: Env,
        drand_pubkey: BytesN<192>,
        g2_neg_generator: BytesN<192>,
        dst: Bytes,
        drand_genesis: u64,
        drand_period: u64,
        usdc: Address,
    ) {
        if is_initialized(&env) {
            panic_with(&env, Error::AlreadyInitialized);
        }
        let config = GlobalConfig {
            drand_pubkey,
            g2_neg_generator,
            dst,
            drand_genesis,
            drand_period,
            usdc,
        };
        set_config(&env, &config);
        bump_instance(&env);
    }

    /// Open a new sealed round. Permissionless: anyone can be an operator, and
    /// the operator gets no special read power — that is the point.
    pub fn create_round(
        env: Env,
        operator: Address,
        item_ref: BytesN<32>,
        reveal_round: u64,
        clearing_rule: ClearingRule,
        commit_deadline: u64,
        reveal_deadline: u64,
        auditor_pubkey: Bytes,
    ) -> Result<u64, Error> {
        operator.require_auth();
        let config = get_config(&env)?;
        bump_instance(&env);

        if reveal_round == 0 {
            return Err(Error::InvalidAmount);
        }
        if auditor_pubkey.len() > MAX_AUDITOR_PUBKEY {
            return Err(Error::PayloadTooLarge);
        }

        let now = env.ledger().timestamp();
        let t_reveal = drand::time_of_round(&config, reveal_round);

        // Commit must close strictly before R is published, otherwise a bidder
        // could decrypt others' sealed bids before committing.
        if commit_deadline >= t_reveal {
            return Err(Error::CommitDeadlineAfterReveal);
        }
        if reveal_deadline <= t_reveal {
            return Err(Error::CommitDeadlineAfterReveal);
        }
        if commit_deadline <= now {
            return Err(Error::DeadlineInPast);
        }

        let round_id = next_round_id(&env);
        let round = Round {
            operator: operator.clone(),
            item_ref,
            reveal_round,
            clearing_rule,
            commit_deadline,
            reveal_deadline,
            auditor_pubkey,
            status: Status::Open,
            bidders: Vec::new(&env),
            winner: None,
            winning_bid: 0,
        };
        set_round(&env, round_id, &round);

        env.events().publish(
            (symbol_short!("created"), round_id),
            (operator, reveal_round, commit_deadline),
        );
        Ok(round_id)
    }

    /// Submit (or overwrite, before the deadline) a sealed bid and lock escrow.
    ///
    /// - `commitment` H binds the bid; checked at reveal.
    /// - `ciphertext` C is the timelock seal; guarantees forced reveal.
    /// - `escrow` is a public USDC budget and an upper bound on the sealed bid;
    ///   locked now so the winner can always pay.
    /// - `auditor_blob` is the bidder identity encrypted to the auditor key.
    pub fn commit(
        env: Env,
        round_id: u64,
        bidder: Address,
        commitment: BytesN<32>,
        ciphertext: Bytes,
        escrow: i128,
        auditor_blob: Bytes,
    ) -> Result<(), Error> {
        bidder.require_auth();
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;

        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() > round.commit_deadline {
            return Err(Error::CommitClosed);
        }
        if escrow <= 0 {
            return Err(Error::InvalidAmount);
        }
        if ciphertext.len() > MAX_CIPHERTEXT || auditor_blob.len() > MAX_AUDITOR_BLOB {
            return Err(Error::PayloadTooLarge);
        }

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        // Overwrite-before-close: refund the prior escrow, then re-lock the new
        // amount. This keeps "one effective bid per bidder" while allowing edits.
        match try_get_state(&env, round_id, &bidder) {
            Some(prev) => {
                if prev.escrow > 0 {
                    usdc.transfer(&contract, &bidder, &prev.escrow);
                }
            }
            None => {
                if round.bidders.len() >= MAX_BIDDERS {
                    return Err(Error::RoundFull);
                }
                round.bidders.push_back(bidder.clone());
            }
        }

        usdc.transfer(&bidder, &contract, &escrow);

        let state = BidState {
            commitment,
            escrow,
            revealed_value: None,
            revealed_nonce: None,
            valid: false,
            settled: false,
        };
        set_state(&env, round_id, &bidder, &state);
        set_seal(
            &env,
            round_id,
            &bidder,
            &Seal {
                ciphertext,
                auditor_blob,
            },
            round.reveal_deadline,
        );
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("commit"), round_id), (bidder, escrow));
        Ok(())
    }

    /// Open the reveal window by proving Drand round R has been produced.
    ///
    /// The supplied signature is verified on-chain via BLS12-381. This is the
    /// only way to move a round into `Revealing`; there is no operator override.
    pub fn open_reveal(
        env: Env,
        round_id: u64,
        drand_signature: BytesN<96>,
    ) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;

        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status != Status::Open {
            return Err(Error::RevealAlreadyOpen);
        }
        if env.ledger().timestamp() <= round.commit_deadline {
            return Err(Error::CommitNotClosed);
        }
        if !drand::verify_round(&env, &config, round.reveal_round, &drand_signature) {
            return Err(Error::InvalidDrandSignature);
        }

        round.status = Status::Revealing;
        extend_round_seals(&env, round_id, &round.bidders, round.reveal_deadline);
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("revealing"), round_id), round.reveal_round);
        Ok(())
    }

    /// Reveal a bid. Permissionless: once R's signature is public, anyone can
    /// decrypt any ciphertext and submit the reveal — so no bidder can abort.
    /// The contract checks `sha256(be16(value) ‖ nonce) == H`.
    pub fn reveal(
        env: Env,
        round_id: u64,
        bidder: Address,
        value: i128,
        nonce: BytesN<32>,
    ) -> Result<(), Error> {
        let round = get_round(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() > round.reveal_deadline {
            return Err(Error::RevealWindowClosed);
        }

        let mut state = get_state(&env, round_id, &bidder)?;
        if state.revealed_value.is_some() {
            return Err(Error::AlreadyRevealed);
        }

        let mut preimage = Bytes::new(&env);
        preimage.extend_from_array(&value.to_be_bytes());
        preimage.extend_from_array(&nonce.to_array());
        let computed = env.crypto().sha256(&preimage).to_bytes();

        // A reveal MUST match the commitment, or it is rejected outright with no
        // state change. Reveal is permissionless, so without this a third party
        // could grief an honest bidder by front-running their reveal with a
        // garbage value — locking them out (AlreadyRevealed) and invalidating
        // their bid. Since the canonical value is recoverable by anyone from the
        // ciphertext after R, only the value that hashes to H is ever recorded.
        if computed != state.commitment {
            return Err(Error::HashMismatch);
        }

        // The committed value is canonical, but a reveal above escrow is rejected
        // outright so integrators see BidExceedsEscrow instead of a silent invalid bid.
        if value > state.escrow {
            return Err(Error::BidExceedsEscrow);
        }

        state.revealed_value = Some(value);
        state.revealed_nonce = Some(nonce.clone());
        state.valid = value > 0;
        set_state(&env, round_id, &bidder, &state);

        env.events().publish(
            (symbol_short!("reveal"), round_id),
            (bidder, value, state.valid),
        );
        Ok(())
    }

    /// Deterministically compute the winner after the reveal deadline. If no
    /// valid bid was revealed, the round is voided and all escrow becomes
    /// refundable.
    pub fn clear(env: Env, round_id: u64) -> Result<Option<Address>, Error> {
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() <= round.reveal_deadline {
            return Err(Error::RevealStillOpen);
        }

        let mut winner: Option<Address> = None;
        let mut best: i128 = 0;
        let mut found = false;

        for bidder in round.bidders.iter() {
            let state = match try_get_state(&env, round_id, &bidder) {
                Some(s) => s,
                None => continue,
            };
            if !state.valid {
                continue;
            }
            let value = match state.revealed_value {
                Some(v) => v,
                None => continue,
            };
            let better = if !found {
                true
            } else {
                match round.clearing_rule {
                    ClearingRule::HighestBid => value > best,
                    ClearingRule::LowestBid => value < best,
                }
            };
            if better {
                best = value;
                winner = Some(bidder.clone());
                found = true;
            }
        }

        if !found {
            round.status = Status::Voided;
            set_round(&env, round_id, &round);
            refund_all(&env, &round, round_id);
            env.events().publish((symbol_short!("voided"), round_id), 0u32);
            return Ok(None);
        }

        round.winner = winner.clone();
        round.winning_bid = best;
        round.status = Status::Cleared;
        set_round(&env, round_id, &round);

        env.events()
            .publish((symbol_short!("cleared"), round_id), (winner.clone(), best));
        Ok(winner)
    }

    /// Settle a cleared round. The winner pays their bid from escrow to the
    /// operator; the winner's surplus and every loser's escrow are refunded.
    /// Cannot fail for lack of funds — everything was escrowed at commit.
    pub fn settle(env: Env, round_id: u64) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Cleared {
            return Err(Error::NotCleared);
        }
        let winner = round.winner.clone().ok_or(Error::NoValidBids)?;

        let usdc = token::Client::new(&env, &config.usdc);
        let contract = env.current_contract_address();

        for bidder in round.bidders.iter() {
            let mut state = match try_get_state(&env, round_id, &bidder) {
                Some(s) => s,
                None => continue,
            };
            if state.settled {
                continue;
            }
            if bidder == winner {
                usdc.transfer(&contract, &round.operator, &round.winning_bid);
                let surplus = state.escrow - round.winning_bid;
                if surplus > 0 {
                    usdc.transfer(&contract, &bidder, &surplus);
                }
            } else if state.escrow > 0 {
                usdc.transfer(&contract, &bidder, &state.escrow);
            }
            state.settled = true;
            set_state(&env, round_id, &bidder, &state);
        }

        round.status = Status::Settled;
        set_round(&env, round_id, &round);

        env.events().publish(
            (symbol_short!("settled"), round_id),
            (winner, round.winning_bid),
        );
        Ok(())
    }

    /// Liveness safety valve: if Drand round R is never produced (network stall)
    /// and the grace window after the reveal deadline has passed without the
    /// round opening, anyone can void it and all escrow is refunded.
    pub fn void(env: Env, round_id: u64) -> Result<(), Error> {
        let mut round = get_round(&env, round_id)?;
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open {
            return Err(Error::NotVoidable);
        }
        if env.ledger().timestamp() <= round.reveal_deadline + VOID_GRACE {
            return Err(Error::NotVoidable);
        }

        round.status = Status::Voided;
        set_round(&env, round_id, &round);
        refund_all(&env, &round, round_id);

        env.events().publish((symbol_short!("voided"), round_id), 1u32);
        Ok(())
    }

    // ---- Core v2 -----------------------------------------------------------

    /// Create a versioned structured-submission round. V2 state uses separate
    /// storage keys, so deployed v1 rounds and methods remain readable.
    pub fn create_round_v2(
        env: Env,
        operator: Address,
        item_ref: BytesN<32>,
        schema_ref: BytesN<32>,
        settlement: SettlementConfig,
        reveal_round: u64,
        clearing_rule: ClearingRule,
        commit_deadline: u64,
        reveal_deadline: u64,
        auditor_pubkey: Bytes,
        max_participants: u32,
    ) -> Result<u64, Error> {
        create_round_v2_impl(
            &env,
            operator,
            item_ref,
            schema_ref,
            settlement,
            reveal_round,
            clearing_rule,
            commit_deadline,
            reveal_deadline,
            auditor_pubkey,
            max_participants,
            None,
        )
    }

    /// Create a partner round with a contract-enforced fixed auction escrow
    /// and optional participant allowlist. Existing Core v2 rounds remain valid.
    pub fn create_partner_round_v2(
        env: Env,
        operator: Address,
        item_ref: BytesN<32>,
        schema_ref: BytesN<32>,
        policy: RoundPolicyV2,
        reveal_round: u64,
        clearing_rule: ClearingRule,
        commit_deadline: u64,
        reveal_deadline: u64,
        auditor_pubkey: Bytes,
        max_participants: u32,
    ) -> Result<u64, Error> {
        let settlement = policy.settlement.clone();
        create_round_v2_impl(
            &env,
            operator,
            item_ref,
            schema_ref,
            settlement,
            reveal_round,
            clearing_rule,
            commit_deadline,
            reveal_deadline,
            auditor_pubkey,
            max_participants,
            Some(policy),
        )
    }

    /// Capability version. Existing v1/v2 creation APIs retain timed opening.
    pub fn protocol_version(_env: Env) -> u32 {
        REVEAL_POLICY_VERSION
    }

    /// Versioned creation with immutable opening policy. The operator is the
    /// controller; a mandatory fallback leaves at least five minutes to reveal.
    pub fn create_round_v3(
        env: Env,
        operator: Address,
        item_ref: BytesN<32>,
        schema_ref: BytesN<32>,
        policy: RoundPolicyV3,
        reveal_round: u64,
        clearing_rule: ClearingRule,
        commit_deadline: u64,
        reveal_deadline: u64,
        auditor_pubkey: Bytes,
        max_participants: u32,
    ) -> Result<u64, Error> {
        let config = get_config(&env)?;
        let privacy_at = drand::time_of_round(&config, reveal_round);
        if let RevealPolicy::OwnerTriggered(fallback_at) = policy.reveal {
            if fallback_at <= privacy_at ||
                reveal_deadline.checked_sub(fallback_at).unwrap_or(0) < MIN_REVEAL_WINDOW {
                return Err(Error::InvalidRevealPolicy);
            }
        }
        let id = create_round_v2_impl(
            &env, operator, item_ref, schema_ref, policy.partner.settlement.clone(),
            reveal_round, clearing_rule, commit_deadline, reveal_deadline,
            auditor_pubkey, max_participants, Some(policy.partner),
        )?;
        let mut round = get_round_v2(&env, id)?;
        round.protocol_version = REVEAL_POLICY_VERSION;
        set_round_v2(&env, id, &round);
        set_reveal_state_v3(&env, id, &RevealStateV3 { policy: policy.reveal.clone(), opened_at: None });
        env.events().publish((symbol_short!("policyv3"), id), policy.reveal);
        Ok(id)
    }

    pub fn get_reveal_state_v3(env: Env, round_id: u64) -> Result<RevealStateV3, Error> {
        let round = get_round_v2(&env, round_id)?;
        if round.protocol_version != REVEAL_POLICY_VERSION {
            return Err(Error::UnsupportedVersion);
        }
        get_reveal_state_v3(&env, round_id)
    }

    /// Commit a full structured payload hash. Auction rounds require escrow;
    /// receipt-only rounds reject escrow and never touch the token contract.
    pub fn commit_v2(
        env: Env,
        round_id: u64,
        bidder: Address,
        commitment: BytesN<32>,
        ciphertext: Bytes,
        escrow: i128,
        auditor_blob: Bytes,
    ) -> Result<(), Error> {
        bidder.require_auth();
        let _config = get_config(&env)?;
        let mut round = get_round_v2(&env, round_id)?;
        if round.protocol_version != CORE_V2_VERSION && round.protocol_version != REVEAL_POLICY_VERSION {
            return Err(Error::UnsupportedVersion);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() > round.commit_deadline {
            return Err(Error::CommitClosed);
        }
        match round.mode {
            RoundMode::Auction if escrow <= 0 => return Err(Error::InvalidAmount),
            RoundMode::ReceiptOnly if escrow != 0 => return Err(Error::EscrowNotAllowed),
            _ => {}
        }
        if let Some(policy) = get_round_policy_v2(&env, round_id) {
            let mut eligible = policy.eligible_participants.is_empty();
            for allowed in policy.eligible_participants.iter() {
                if allowed == bidder {
                    eligible = true;
                    break;
                }
            }
            if !eligible {
                return Err(Error::ParticipantNotEligible);
            }
            if round.mode == RoundMode::Auction && escrow != policy.fixed_escrow {
                return Err(Error::EscrowPolicyMismatch);
            }
        }
        if ciphertext.len() > MAX_CIPHERTEXT || auditor_blob.len() > MAX_AUDITOR_BLOB {
            return Err(Error::PayloadTooLarge);
        }

        let contract = env.current_contract_address();
        match try_get_submission_v2(&env, round_id, &bidder) {
            Some(previous) => {
                if previous.escrow > 0 {
                    let payment_asset = round
                        .payment_asset
                        .clone()
                        .ok_or(Error::InvalidAmount)?;
                    let token = token::Client::new(&env, &payment_asset);
                    token.transfer(&contract, &bidder, &previous.escrow);
                }
            }
            None => {
                if round.bidders.len() >= round.max_participants {
                    return Err(Error::RoundFull);
                }
                round.bidders.push_back(bidder.clone());
            }
        }
        if escrow > 0 {
            let payment_asset = round
                .payment_asset
                .clone()
                .ok_or(Error::InvalidAmount)?;
            let token = token::Client::new(&env, &payment_asset);
            token.transfer(&bidder, &contract, &escrow);
        }

        set_submission_v2(
            &env,
            round_id,
            &bidder,
            &SubmissionStateV2 {
                commitment,
                escrow,
                revealed_envelope: None,
                revealed_amount: None,
                valid: false,
                settled: false,
            },
        );
        set_seal_v2(
            &env,
            round_id,
            &bidder,
            &Seal {
                ciphertext,
                auditor_blob,
            },
            round.reveal_deadline,
        );
        set_round_v2(&env, round_id, &round);
        env.events()
            .publish((symbol_short!("commitv2"), round_id), (bidder, escrow));
        Ok(())
    }

    pub fn open_reveal_v2(
        env: Env,
        round_id: u64,
        drand_signature: BytesN<96>,
    ) -> Result<(), Error> {
        let config = get_config(&env)?;
        let mut round = get_round_v2(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status != Status::Open {
            return Err(Error::RevealAlreadyOpen);
        }
        if env.ledger().timestamp() <= round.commit_deadline {
            return Err(Error::CommitNotClosed);
        }
        let now = env.ledger().timestamp();
        let mut reveal_state = if round.protocol_version == REVEAL_POLICY_VERSION {
            let state = get_reveal_state_v3(&env, round_id)?;
            if now < drand::time_of_round(&config, round.reveal_round) {
                return Err(Error::CommitNotClosed);
            }
            if now > round.reveal_deadline {
                return Err(Error::RevealWindowClosed);
            }
            if let RevealPolicy::OwnerTriggered(fallback_at) = state.policy {
                if now < fallback_at {
                    round.operator.require_auth();
                }
            }
            Some(state)
        } else {
            None
        };
        if !drand::verify_round(&env, &config, round.reveal_round, &drand_signature) {
            return Err(Error::InvalidDrandSignature);
        }

        if let Some(ref mut state) = reveal_state {
            state.opened_at = Some(now);
            set_reveal_state_v3(&env, round_id, state);
        }
        round.status = Status::Revealing;
        extend_round_seals_v2(&env, round_id, &round.bidders, round.reveal_deadline);
        set_round_v2(&env, round_id, &round);
        env.events()
            .publish((symbol_short!("revealv2"), round_id), round.reveal_round);
        Ok(())
    }

    /// Reveal the complete canonical envelope. The contract hashes every byte,
    /// then interprets only the versioned amount field required for clearing.
    pub fn reveal_v2(
        env: Env,
        round_id: u64,
        bidder: Address,
        envelope: Bytes,
    ) -> Result<(), Error> {
        let round = get_round_v2(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() > round.reveal_deadline {
            return Err(Error::RevealWindowClosed);
        }

        let mut state = get_submission_v2(&env, round_id, &bidder)?;
        if state.revealed_envelope.is_some() {
            return Err(Error::AlreadyRevealed);
        }
        let computed = env.crypto().sha256(&envelope).to_bytes();
        if computed != state.commitment {
            return Err(Error::HashMismatch);
        }
        let decoded = payload::decode_envelope(&env, &envelope)?;

        match round.mode {
            RoundMode::Auction => {
                let amount = decoded.amount.ok_or(Error::MalformedPayload)?;
                if amount <= 0 {
                    return Err(Error::InvalidAmount);
                }
                if amount > state.escrow {
                    return Err(Error::BidExceedsEscrow);
                }
            }
            RoundMode::ReceiptOnly => {
                if state.escrow != 0 {
                    return Err(Error::EscrowNotAllowed);
                }
            }
        }

        state.revealed_amount = decoded.amount;
        state.revealed_envelope = Some(envelope);
        state.valid = true;
        set_submission_v2(&env, round_id, &bidder, &state);
        env.events().publish(
            (symbol_short!("openedv2"), round_id),
            (bidder, decoded.amount.unwrap_or(0)),
        );
        Ok(())
    }

    /// Finalize a receipt-only round, or deterministically clear an auction.
    pub fn clear_v2(env: Env, round_id: u64) -> Result<Option<Address>, Error> {
        let mut round = get_round_v2(&env, round_id)?;
        if round.status == Status::Cleared {
            return Err(Error::AlreadyCleared);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status != Status::Revealing {
            return Err(Error::RevealNotOpen);
        }
        if env.ledger().timestamp() <= round.reveal_deadline {
            return Err(Error::RevealStillOpen);
        }

        if round.mode == RoundMode::ReceiptOnly {
            for bidder in round.bidders.iter() {
                if let Some(mut state) = try_get_submission_v2(&env, round_id, &bidder) {
                    state.settled = true;
                    set_submission_v2(&env, round_id, &bidder, &state);
                }
            }
            round.status = Status::Settled;
            set_round_v2(&env, round_id, &round);
            env.events().publish(
                (symbol_short!("finalv2"), round_id),
                round.bidders.len(),
            );
            return Ok(None);
        }

        let mut winner: Option<Address> = None;
        let mut best = 0i128;
        let mut found = false;
        for bidder in round.bidders.iter() {
            let state = match try_get_submission_v2(&env, round_id, &bidder) {
                Some(value) => value,
                None => continue,
            };
            if !state.valid {
                continue;
            }
            let amount = match state.revealed_amount {
                Some(value) => value,
                None => continue,
            };
            let better = if !found {
                true
            } else {
                match round.clearing_rule {
                    ClearingRule::HighestBid => amount > best,
                    ClearingRule::LowestBid => amount < best,
                }
            };
            if better {
                best = amount;
                winner = Some(bidder.clone());
                found = true;
            }
        }

        if !found {
            round.status = Status::Voided;
            set_round_v2(&env, round_id, &round);
            refund_all_v2(&env, &round, round_id);
            env.events()
                .publish((symbol_short!("voidedv2"), round_id), 0u32);
            return Ok(None);
        }

        round.winner = winner.clone();
        round.winning_bid = best;
        round.status = Status::Cleared;
        set_round_v2(&env, round_id, &round);
        env.events().publish(
            (symbol_short!("clearedv2"), round_id),
            (winner.clone(), best),
        );
        Ok(winner)
    }

    pub fn settle_v2(env: Env, round_id: u64) -> Result<(), Error> {
        let _config = get_config(&env)?;
        let mut round = get_round_v2(&env, round_id)?;
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.mode != RoundMode::Auction || round.status != Status::Cleared {
            return Err(Error::NotCleared);
        }
        let winner = round.winner.clone().ok_or(Error::NoValidBids)?;
        let payment_asset = round.payment_asset.clone().ok_or(Error::InvalidAmount)?;
        let token = token::Client::new(&env, &payment_asset);
        let contract = env.current_contract_address();

        for bidder in round.bidders.iter() {
            let mut state = match try_get_submission_v2(&env, round_id, &bidder) {
                Some(value) => value,
                None => continue,
            };
            if state.settled {
                continue;
            }
            if bidder == winner {
                token.transfer(&contract, &round.operator, &round.winning_bid);
                let surplus = state.escrow - round.winning_bid;
                if surplus > 0 {
                    token.transfer(&contract, &bidder, &surplus);
                }
            } else if state.escrow > 0 {
                token.transfer(&contract, &bidder, &state.escrow);
            }
            state.settled = true;
            set_submission_v2(&env, round_id, &bidder, &state);
        }

        let lot_asset = round.lot_asset.clone().ok_or(Error::InvalidAmount)?;
        token::Client::new(&env, &lot_asset).transfer(
            &contract,
            &winner,
            &round.lot_amount,
        );

        round.status = Status::Settled;
        set_round_v2(&env, round_id, &round);
        env.events().publish(
            (symbol_short!("settledv2"), round_id),
            (winner, round.winning_bid),
        );
        Ok(())
    }

    pub fn void_v2(env: Env, round_id: u64) -> Result<(), Error> {
        let mut round = get_round_v2(&env, round_id)?;
        if round.status == Status::Voided {
            return Err(Error::RoundVoided);
        }
        if round.status == Status::Settled {
            return Err(Error::AlreadySettled);
        }
        if round.status != Status::Open
            || env.ledger().timestamp() <= round.reveal_deadline.saturating_add(VOID_GRACE)
        {
            return Err(Error::NotVoidable);
        }
        round.status = Status::Voided;
        set_round_v2(&env, round_id, &round);
        refund_all_v2(&env, &round, round_id);
        env.events()
            .publish((symbol_short!("voidedv2"), round_id), 1u32);
        Ok(())
    }

    pub fn get_round_v2(env: Env, round_id: u64) -> Result<RoundV2, Error> {
        storage::get_round_v2(&env, round_id)
    }

    pub fn get_round_policy_v2(env: Env, round_id: u64) -> Option<RoundPolicyV2> {
        storage::get_round_policy_v2(&env, round_id)
    }

    pub fn get_submission_v2(
        env: Env,
        round_id: u64,
        bidder: Address,
    ) -> Result<SubmissionStateV2, Error> {
        storage::get_submission_v2(&env, round_id, &bidder)
    }

    pub fn get_bidders_v2(env: Env, round_id: u64) -> Result<Vec<Address>, Error> {
        Ok(storage::get_round_v2(&env, round_id)?.bidders)
    }

    pub fn get_seal_v2(env: Env, round_id: u64, bidder: Address) -> Option<Seal> {
        let round = storage::get_round_v2(&env, round_id).ok()?;
        storage::get_seal_v2(&env, round_id, &bidder, round.reveal_deadline)
    }

    // ---- Views ----

    pub fn get_round(env: Env, round_id: u64) -> Result<Round, Error> {
        storage::get_round(&env, round_id)
    }

    pub fn get_bid_state(env: Env, round_id: u64, bidder: Address) -> Result<BidState, Error> {
        storage::get_state(&env, round_id, &bidder)
    }

    /// Keeper view: the deterministic, ordered bidder index for a round. The
    /// keeper reads this to learn exactly which seals must be opened and
    /// revealed — the reveal set is on-chain state, so no event scraping or
    /// indexer is required and nothing can be missed.
    pub fn get_bidders(env: Env, round_id: u64) -> Result<Vec<Address>, Error> {
        Ok(storage::get_round(&env, round_id)?.bidders)
    }

    /// Paginated bidder index for a round. Returns a page of bidders starting
    /// at `cursor` (zero-based), with continuation metadata.
    ///
    /// `limit` must be 1–100. `next_cursor` in the response is 0 when there
    /// are no more pages.
    pub fn get_bidders_page(
        env: Env,
        round_id: u64,
        cursor: u32,
        limit: u32,
    ) -> Result<BiddersPage, Error> {
        if limit == 0 || limit > MAX_PAGE_SIZE {
            return Err(Error::InvalidLimit);
        }
        let bidders = storage::get_round(&env, round_id)?.bidders;
        let total = bidders.len();
        let start = cursor.min(total);
        let end = (start + limit).min(total);
        let mut data: Vec<Address> = Vec::new(&env);
        for i in start..end {
            data.push_back(bidders.get(i).unwrap());
        }
        let next_cursor = if end < total { end } else { 0 };
        Ok(BiddersPage {
            data,
            next_cursor,
            total,
        })
    }

    /// Observer view: the sealed ciphertext + auditor blob while still in
    /// Temporary storage. Returns `None` once the seal TTL has expired (by design
    /// after the reveal window). Persistent bid state remains for settlement.
    pub fn get_seal(env: Env, round_id: u64, bidder: Address) -> Option<Seal> {
        let round = storage::get_round(&env, round_id).ok()?;
        storage::get_seal(&env, round_id, &bidder, round.reveal_deadline)
    }

    pub fn get_config(env: Env) -> Result<GlobalConfig, Error> {
        storage::get_config(&env)
    }
}

/// Refund every locked escrow for a voided round.
fn refund_all(env: &Env, round: &Round, round_id: u64) {
    let config = match storage::get_config(env) {
        Ok(c) => c,
        Err(_) => return,
    };
    let usdc = token::Client::new(env, &config.usdc);
    let contract = env.current_contract_address();
    for bidder in round.bidders.iter() {
        if let Some(mut state) = try_get_state(env, round_id, &bidder) {
            if !state.settled && state.escrow > 0 {
                usdc.transfer(&contract, &bidder, &state.escrow);
                state.settled = true;
                set_state(env, round_id, &bidder, &state);
            }
        }
    }
}

fn refund_all_v2(env: &Env, round: &RoundV2, round_id: u64) {
    let contract = env.current_contract_address();
    if let Some(payment_asset) = round.payment_asset.clone() {
        let token = token::Client::new(env, &payment_asset);
        for bidder in round.bidders.iter() {
            if let Some(mut state) = try_get_submission_v2(env, round_id, &bidder) {
                if !state.settled && state.escrow > 0 {
                    token.transfer(&contract, &bidder, &state.escrow);
                }
                state.settled = true;
                set_submission_v2(env, round_id, &bidder, &state);
            }
        }
    }
    if let Some(lot_asset) = round.lot_asset.clone() {
        token::Client::new(env, &lot_asset).transfer(
            &contract,
            &round.operator,
            &round.lot_amount,
        );
    }
}

fn panic_with(env: &Env, error: Error) -> ! {
    soroban_sdk::panic_with_error!(env, error)
}

#[cfg(test)]
mod test;
