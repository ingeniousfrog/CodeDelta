import type { TrainingDiffHunk } from '@codedelta/types';

interface HunkState {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: string[];
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function finalizeHunk(file: string, index: number, state: HunkState): TrainingDiffHunk {
  return {
    id: `${file}:h${index}`,
    file,
    oldStart: state.oldStart,
    oldLines: state.oldLines,
    newStart: state.newStart,
    newLines: state.newLines,
    header: state.header,
    lines: state.lines,
  };
}

export function parseTrainingDiffHunks(diffText: string): TrainingDiffHunk[] {
  const hunks: TrainingDiffHunk[] = [];
  let currentFile = '';
  let currentHunk: HunkState | null = null;
  let hunkIndexByFile = new Map<string, number>();

  const pushHunk = (): void => {
    if (!currentHunk || !currentFile) return;
    const nextIndex = (hunkIndexByFile.get(currentFile) ?? 0) + 1;
    hunkIndexByFile = new Map(hunkIndexByFile).set(currentFile, nextIndex);
    hunks.push(finalizeHunk(currentFile, nextIndex, currentHunk));
    currentHunk = null;
  };

  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      pushHunk();
      currentFile = '';
      continue;
    }

    if (line.startsWith('+++ ')) {
      const nextFile = line.slice(4).trim();
      currentFile = nextFile.startsWith('b/') ? nextFile.slice(2) : nextFile;
      continue;
    }

    const match = line.match(HUNK_HEADER_RE);
    if (match && currentFile) {
      pushHunk();
      currentHunk = {
        file: currentFile,
        oldStart: Number(match[1]),
        oldLines: Number(match[2] ?? '1'),
        newStart: Number(match[3]),
        newLines: Number(match[4] ?? '1'),
        header: line,
        lines: [],
      };
      continue;
    }

    if (currentHunk) {
      currentHunk = { ...currentHunk, lines: [...currentHunk.lines, line] };
    }
  }

  pushHunk();
  return hunks;
}
