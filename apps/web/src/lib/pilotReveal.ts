export interface PilotRevealAction {
  visible: boolean;
  ready: boolean;
  label: string;
}

function formatRemaining(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;

  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function pilotRevealAction(
  status: string,
  drandPublished: boolean,
  secondsRemaining: number,
  allSubmissionsRevealed = false,
  opening?: { controller: string; caller: string | null; fallbackAt: number; now: number; revealDeadline: number },
): PilotRevealAction {
  if (opening && opening.now > opening.revealDeadline && (status === "Open" || status === "Revealing")) {
    return { visible: false, ready: false, label: "Reveal window closed" };
  }
  if (status === "Revealing") {
    return allSubmissionsRevealed
      ? { visible: true, ready: false, label: "Reveal complete" }
      : { visible: true, ready: true, label: "Reveal submissions" };
  }

  if (status !== "Open") {
    return { visible: false, ready: false, label: "Open + reveal" };
  }

  if (!drandPublished) {
    return {
      visible: true,
      ready: false,
      label: `Reveal in ${formatRemaining(secondsRemaining)}`,
    };
  }

  if (opening && opening.now < opening.fallbackAt && opening.caller !== opening.controller) {
    return { visible: true, ready: false, label: `Awaiting owner · public opening in ${formatRemaining(opening.fallbackAt - opening.now)}` };
  }
  return { visible: true, ready: true, label: "Open + reveal" };
}
