export class SnapshotBuildError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SnapshotBuildError';
  }
}

export class SnapshotTooLargeError extends Error {
  constructor(
    message: string,
    public readonly nodeCount: number,
  ) {
    super(message);
    this.name = 'SnapshotTooLargeError';
  }
}

export class SnapshotTimeoutError extends Error {
  constructor(message = 'Snapshot build timed out') {
    super(message);
    this.name = 'SnapshotTimeoutError';
  }
}

export class SnapshotEmptyError extends Error {
  constructor(message = 'Repository produced an empty structural graph') {
    super(message);
    this.name = 'SnapshotEmptyError';
  }
}
