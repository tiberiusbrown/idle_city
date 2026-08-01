import { runBalance } from './runner';

function integerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(parsed))
    throw new Error(`--${name} requires a safe integer.`);
  return parsed;
}

const summary = runBalance({
  seed: integerArgument('seed', 1234),
  ticks: integerArgument('ticks', 1000),
});
process.stdout.write(`${JSON.stringify(summary)}\n`);
