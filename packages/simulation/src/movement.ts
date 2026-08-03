import { stableHash, type CitizenId, type GridPosition } from '@idle-city/shared';

const MOVEMENT_UNITS_PER_CELL = 1024;
const MAX_WATCHDOG_CHAIN_LENGTH = 8;

export type MovementProposalKind = 'route' | 'internal' | 'sidestep' | 'recovery' | 'emergency';

export interface MovementParticipant {
  readonly id: CitizenId;
  readonly position: GridPosition;
  readonly movementCredit: number;
  readonly blockedMovementCount: number;
  readonly remainingRouteCells: number;
  readonly goalStartTick: number;
}

export interface MovementProposal {
  readonly citizenId: CitizenId;
  readonly from: GridPosition;
  readonly target: GridPosition;
  readonly kind: MovementProposalKind;
}

export interface AcceptedMovement {
  readonly citizenId: CitizenId;
  readonly target: GridPosition;
  readonly kind: MovementProposalKind;
  /** True when recovery moved a citizen that had no independent proposal. */
  readonly implicit: boolean;
}

export interface MovementResolution {
  readonly accepted: readonly AcceptedMovement[];
  readonly rejected: readonly CitizenId[];
  readonly watchdogRecovery: boolean;
}

export interface MovementResolutionOptions {
  readonly seed: number;
  readonly occupancy: ReadonlyMap<string, CitizenId>;
  readonly participants: readonly MovementParticipant[];
  readonly proposals: readonly MovementProposal[];
  /** Consecutive preceding no-progress ticks, before this resolution. */
  readonly noProgressTicks: number;
  /** Static, citizen-specific legality such as zone or building bounds. */
  readonly isMoveLegal?: (participant: MovementParticipant, target: GridPosition) => boolean;
}

interface InternalProposal extends MovementProposal {
  readonly implicit: boolean;
}

interface InternalRun {
  readonly accepted: readonly AcceptedMovement[];
  readonly acceptedIds: ReadonlySet<CitizenId>;
  readonly normalized: readonly InternalProposal[];
  readonly selected: ReadonlyMap<CitizenId, InternalProposal>;
  readonly selectedByTarget: ReadonlyMap<string, InternalProposal>;
}

interface ChainMove {
  readonly citizenId: CitizenId;
  readonly target: GridPosition;
}

type ResolutionStatus = 'visiting' | 'accepted' | 'rejected';

function compareCitizenIds(left: CitizenId, right: CitizenId): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function movementCellKey(position: GridPosition): string {
  return `${String(position.x)},${String(position.y)}`;
}

function copyPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function isSamePosition(left: GridPosition, right: GridPosition): boolean {
  return left.x === right.x && left.y === right.y;
}

function isAdjacent(left: GridPosition, right: GridPosition): boolean {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) === 1;
}

function compareCoordinates(left: GridPosition, right: GridPosition): number {
  return left.y - right.y || left.x - right.x;
}

function compareProposalPriority(
  left: MovementProposal,
  right: MovementProposal,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
): number {
  const leftParticipant = participants.get(left.citizenId);
  const rightParticipant = participants.get(right.citizenId);
  if (leftParticipant === undefined || rightParticipant === undefined) {
    return compareCitizenIds(left.citizenId, right.citizenId);
  }

  return (
    rightParticipant.blockedMovementCount - leftParticipant.blockedMovementCount ||
    leftParticipant.remainingRouteCells - rightParticipant.remainingRouteCells ||
    leftParticipant.goalStartTick - rightParticipant.goalStartTick ||
    compareCitizenIds(left.citizenId, right.citizenId)
  );
}

function isMoveLegal(
  participant: MovementParticipant,
  proposal: MovementProposal,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): boolean {
  return (
    isSamePosition(participant.position, proposal.from) &&
    participant.movementCredit >= MOVEMENT_UNITS_PER_CELL &&
    isAdjacent(participant.position, proposal.target) &&
    staticMoveLegal(participant, proposal.target)
  );
}

function normalizeProposals(
  proposals: readonly InternalProposal[],
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): readonly InternalProposal[] {
  const sorted = [...proposals].sort((left, right) =>
    compareProposalPriority(left, right, participants),
  );
  const normalized: InternalProposal[] = [];
  const seenCitizens = new Set<CitizenId>();

  for (const proposal of sorted) {
    if (seenCitizens.has(proposal.citizenId)) continue;
    const participant = participants.get(proposal.citizenId);
    if (participant === undefined || !isMoveLegal(participant, proposal, staticMoveLegal)) continue;
    seenCitizens.add(proposal.citizenId);
    normalized.push(proposal);
  }

  return normalized;
}

function selectTargetWinners(
  proposals: readonly InternalProposal[],
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
): {
  readonly selected: ReadonlyMap<CitizenId, InternalProposal>;
  readonly selectedByTarget: ReadonlyMap<string, InternalProposal>;
} {
  const byTarget = new Map<string, InternalProposal[]>();
  for (const proposal of proposals) {
    const targetKey = movementCellKey(proposal.target);
    const targetProposals = byTarget.get(targetKey);
    if (targetProposals === undefined) {
      byTarget.set(targetKey, [proposal]);
    } else {
      targetProposals.push(proposal);
    }
  }

  const selected = new Map<CitizenId, InternalProposal>();
  const selectedByTarget = new Map<string, InternalProposal>();
  for (const [targetKey, targetProposals] of byTarget) {
    targetProposals.sort((left, right) => compareProposalPriority(left, right, participants));
    const winner = targetProposals[0];
    if (winner === undefined) continue;
    selected.set(winner.citizenId, winner);
    selectedByTarget.set(targetKey, winner);
  }

  return { selected, selectedByTarget };
}

function resolveDependencies(
  selected: ReadonlyMap<CitizenId, InternalProposal>,
  occupancy: ReadonlyMap<string, CitizenId>,
): ReadonlySet<CitizenId> {
  const statuses = new Map<CitizenId, ResolutionStatus>();

  const resolve = (citizenId: CitizenId): boolean => {
    const knownStatus = statuses.get(citizenId);
    if (knownStatus === 'accepted') return true;
    if (knownStatus === 'rejected') return false;
    if (knownStatus === 'visiting') {
      // The selected target graph is functional. Returning true here closes a
      // valid dependency cycle; the caller marks every cycle member accepted.
      return true;
    }

    const proposal = selected.get(citizenId);
    if (proposal === undefined) {
      statuses.set(citizenId, 'rejected');
      return false;
    }

    statuses.set(citizenId, 'visiting');
    const occupantId = occupancy.get(movementCellKey(proposal.target));
    const accepted = occupantId === undefined ? true : resolve(occupantId);
    statuses.set(citizenId, accepted ? 'accepted' : 'rejected');
    return accepted;
  };

  const orderedCitizenIds = [...selected.keys()].sort(compareCitizenIds);
  for (const citizenId of orderedCitizenIds) resolve(citizenId);

  const accepted = new Set<CitizenId>();
  for (const [citizenId, status] of statuses) {
    if (status === 'accepted') accepted.add(citizenId);
  }
  return accepted;
}

function runResolution(
  proposals: readonly InternalProposal[],
  options: MovementResolutionOptions,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): InternalRun {
  const normalized = normalizeProposals(proposals, participants, staticMoveLegal);
  const { selected, selectedByTarget } = selectTargetWinners(normalized, participants);
  const acceptedIds = resolveDependencies(selected, options.occupancy);
  const accepted = [...acceptedIds].sort(compareCitizenIds).map((citizenId): AcceptedMovement => {
    const proposal = selected.get(citizenId);
    if (proposal === undefined) throw new Error(`Accepted citizen ${citizenId} has no proposal.`);
    return {
      citizenId,
      target: copyPosition(proposal.target),
      kind: proposal.kind,
      implicit: proposal.implicit,
    };
  });

  return { accepted, acceptedIds, normalized, selected, selectedByTarget };
}

function makeInternalProposal(proposal: MovementProposal, implicit: boolean): InternalProposal {
  return {
    citizenId: proposal.citizenId,
    from: copyPosition(proposal.from),
    target: copyPosition(proposal.target),
    kind: proposal.kind,
    implicit,
  };
}

function replaceProposals(
  proposals: readonly InternalProposal[],
  replacements: readonly InternalProposal[],
): readonly InternalProposal[] {
  const replacementByCitizen = new Map<CitizenId, InternalProposal>();
  for (const replacement of replacements)
    replacementByCitizen.set(replacement.citizenId, replacement);

  const replaced = proposals
    .filter((proposal) => !replacementByCitizen.has(proposal.citizenId))
    .concat(replacements);
  return replaced;
}

function orderedNeighbors(
  seed: number,
  participant: MovementParticipant,
  purpose: string,
): readonly GridPosition[] {
  const candidates: GridPosition[] = [];
  const deltas: readonly (readonly [number, number])[] = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  for (const [xDelta, yDelta] of deltas) {
    const x = participant.position.x + xDelta;
    const y = participant.position.y + yDelta;
    if (Number.isSafeInteger(x) && Number.isSafeInteger(y)) {
      candidates.push({ x, y });
    }
  }

  return candidates.sort((left, right) => {
    const leftKey = stableHash({
      seed,
      purpose,
      citizenId: participant.id,
      blockedMovementCount: participant.blockedMovementCount,
      from: participant.position,
      target: left,
    });
    const rightKey = stableHash({
      seed,
      purpose,
      citizenId: participant.id,
      blockedMovementCount: participant.blockedMovementCount,
      from: participant.position,
      target: right,
    });
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : compareCoordinates(left, right);
  });
}

function findRecoveryChain(
  current: MovementParticipant,
  target: GridPosition,
  depth: number,
  seenCitizens: ReadonlySet<CitizenId>,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  occupancy: ReadonlyMap<string, CitizenId>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
  seed: number,
): readonly ChainMove[] | null {
  if (depth >= MAX_WATCHDOG_CHAIN_LENGTH) return null;
  if (current.movementCredit < MOVEMENT_UNITS_PER_CELL) return null;
  if (!isAdjacent(current.position, target) || !staticMoveLegal(current, target)) return null;

  const occupantId = occupancy.get(movementCellKey(target));
  if (occupantId === undefined) {
    return [{ citizenId: current.id, target: copyPosition(target) }];
  }
  if (seenCitizens.has(occupantId)) return null;

  const occupant = participants.get(occupantId);
  if (occupant === undefined) return null;

  const nextSeen = new Set(seenCitizens);
  nextSeen.add(current.id);
  const candidates = orderedNeighbors(seed, occupant, 'movement-watchdog-chain');
  for (const candidate of candidates) {
    const candidateOccupant = occupancy.get(movementCellKey(candidate));
    if (
      candidateOccupant === current.id ||
      (candidateOccupant !== undefined && nextSeen.has(candidateOccupant))
    ) {
      continue;
    }

    const tail = findRecoveryChain(
      occupant,
      candidate,
      depth + 1,
      nextSeen,
      participants,
      occupancy,
      staticMoveLegal,
      seed,
    );
    if (tail !== null) {
      return [{ citizenId: current.id, target: copyPosition(target) }, ...tail];
    }
  }
  return null;
}

function tryEmergencyRecovery(
  base: InternalRun,
  proposals: readonly InternalProposal[],
  options: MovementResolutionOptions,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): InternalRun | null {
  const orderedProposals = [...base.normalized].sort((left, right) =>
    compareProposalPriority(left, right, participants),
  );

  for (const proposal of orderedProposals) {
    const participant = participants.get(proposal.citizenId);
    if (
      participant === undefined ||
      participant.blockedMovementCount < 12 ||
      base.acceptedIds.has(proposal.citizenId)
    ) {
      continue;
    }

    const blockerId = options.occupancy.get(movementCellKey(proposal.target));
    if (blockerId === undefined || blockerId === proposal.citizenId) continue;

    const targetWinner = base.selectedByTarget.get(movementCellKey(proposal.target));
    if (targetWinner?.citizenId !== proposal.citizenId) continue;

    const blocker = participants.get(blockerId);
    if (
      blocker === undefined ||
      blocker.movementCredit < MOVEMENT_UNITS_PER_CELL ||
      !isAdjacent(blocker.position, proposal.from) ||
      !staticMoveLegal(blocker, proposal.from)
    ) {
      continue;
    }

    const reverseProposal: InternalProposal = {
      citizenId: blocker.id,
      from: copyPosition(blocker.position),
      target: copyPosition(proposal.from),
      kind: 'emergency',
      implicit: true,
    };
    const candidate = runResolution(
      replaceProposals(proposals, [reverseProposal]),
      options,
      participants,
      staticMoveLegal,
    );
    if (candidate.acceptedIds.has(proposal.citizenId) && candidate.acceptedIds.has(blocker.id)) {
      return candidate;
    }
  }
  return null;
}

function trySidestepRecovery(
  base: InternalRun,
  proposals: readonly InternalProposal[],
  options: MovementResolutionOptions,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): InternalRun | null {
  const orderedProposals = [...base.normalized].sort((left, right) =>
    compareProposalPriority(left, right, participants),
  );

  for (const proposal of orderedProposals) {
    const participant = participants.get(proposal.citizenId);
    if (
      participant === undefined ||
      participant.blockedMovementCount < 4 ||
      base.acceptedIds.has(proposal.citizenId)
    ) {
      continue;
    }

    for (const candidate of orderedNeighbors(options.seed, participant, 'movement-sidestep')) {
      if (
        isSamePosition(candidate, proposal.target) ||
        options.occupancy.has(movementCellKey(candidate)) ||
        !staticMoveLegal(participant, candidate)
      ) {
        continue;
      }

      const sidestep: InternalProposal = {
        citizenId: participant.id,
        from: copyPosition(participant.position),
        target: copyPosition(candidate),
        kind: 'sidestep',
        implicit: false,
      };
      const candidateRun = runResolution(
        replaceProposals(proposals, [sidestep]),
        options,
        participants,
        staticMoveLegal,
      );
      if (candidateRun.acceptedIds.has(participant.id)) return candidateRun;
    }
  }
  return null;
}

function tryWatchdogRecovery(
  proposals: readonly InternalProposal[],
  options: MovementResolutionOptions,
  participants: ReadonlyMap<CitizenId, MovementParticipant>,
  staticMoveLegal: (participant: MovementParticipant, target: GridPosition) => boolean,
): InternalRun | null {
  const base = runResolution(proposals, options, participants, staticMoveLegal);
  if (base.accepted.length > 0 || proposals.length === 0 || options.noProgressTicks < 15) {
    return null;
  }

  const waiting = [...base.normalized].sort((left, right) =>
    compareProposalPriority(left, right, participants),
  );
  const selected = waiting[0];
  if (selected === undefined) return null;
  const participant = participants.get(selected.citizenId);
  if (participant === undefined) return null;

  for (const candidate of orderedNeighbors(
    options.seed,
    participant,
    'movement-watchdog-sidestep',
  )) {
    if (
      options.occupancy.has(movementCellKey(candidate)) ||
      !staticMoveLegal(participant, candidate)
    ) {
      continue;
    }

    const sidestep: InternalProposal = {
      citizenId: participant.id,
      from: copyPosition(participant.position),
      target: copyPosition(candidate),
      kind: 'sidestep',
      implicit: false,
    };
    const candidateRun = runResolution(
      replaceProposals(proposals, [sidestep]),
      options,
      participants,
      staticMoveLegal,
    );
    if (candidateRun.acceptedIds.has(participant.id)) return candidateRun;
  }

  const blockerId = options.occupancy.get(movementCellKey(selected.target));
  const blocker = blockerId === undefined ? undefined : participants.get(blockerId);
  if (
    blocker !== undefined &&
    blocker.movementCredit >= MOVEMENT_UNITS_PER_CELL &&
    isAdjacent(blocker.position, participant.position) &&
    staticMoveLegal(blocker, participant.position)
  ) {
    const reverseProposal: InternalProposal = {
      citizenId: blocker.id,
      from: copyPosition(blocker.position),
      target: copyPosition(participant.position),
      kind: 'recovery',
      implicit: true,
    };
    const candidateRun = runResolution(
      replaceProposals(proposals, [reverseProposal]),
      options,
      participants,
      staticMoveLegal,
    );
    if (candidateRun.acceptedIds.has(participant.id) && candidateRun.acceptedIds.has(blocker.id)) {
      return candidateRun;
    }
  }

  const chain = findRecoveryChain(
    participant,
    selected.target,
    0,
    new Set(),
    participants,
    options.occupancy,
    staticMoveLegal,
    options.seed,
  );
  if (chain !== null) {
    const chainProposals = chain.map((move): InternalProposal => {
      const existing = move.citizenId === participant.id ? selected : undefined;
      if (existing !== undefined && isSamePosition(existing.target, move.target)) return existing;

      const chainParticipant = participants.get(move.citizenId);
      if (chainParticipant === undefined) {
        throw new Error(`Recovery chain referenced unknown citizen ${move.citizenId}.`);
      }
      return {
        citizenId: move.citizenId,
        from: copyPosition(chainParticipant.position),
        target: copyPosition(move.target),
        kind: 'recovery',
        implicit: true,
      };
    });
    const candidateRun = runResolution(
      replaceProposals(proposals, chainProposals),
      options,
      participants,
      staticMoveLegal,
    );
    if (chain.every((move) => candidateRun.acceptedIds.has(move.citizenId))) return candidateRun;
  }

  return null;
}

export function resolveMovementProposals(options: MovementResolutionOptions): MovementResolution {
  const participants = new Map<CitizenId, MovementParticipant>();
  for (const participant of options.participants) participants.set(participant.id, participant);

  const staticMoveLegal = options.isMoveLegal ?? (() => true);
  const originalProposals = options.proposals.map((proposal) =>
    makeInternalProposal(proposal, false),
  );
  let run = runResolution(originalProposals, options, participants, staticMoveLegal);
  let watchdogRecovery = false;

  const sidestep = trySidestepRecovery(
    run,
    originalProposals,
    options,
    participants,
    staticMoveLegal,
  );
  const emergency =
    sidestep === null
      ? tryEmergencyRecovery(run, originalProposals, options, participants, staticMoveLegal)
      : null;
  if (sidestep !== null) {
    run = sidestep;
  } else if (emergency !== null) {
    run = emergency;
  } else if (run.accepted.length === 0) {
    const watchdog = tryWatchdogRecovery(originalProposals, options, participants, staticMoveLegal);
    if (watchdog !== null) {
      run = watchdog;
      watchdogRecovery = true;
    }
  }

  const acceptedIds = run.acceptedIds;
  const rejected = [...new Set(options.proposals.map((proposal) => proposal.citizenId))]
    .filter((citizenId) => !acceptedIds.has(citizenId))
    .sort(compareCitizenIds);

  return {
    accepted: run.accepted,
    rejected,
    watchdogRecovery,
  };
}
