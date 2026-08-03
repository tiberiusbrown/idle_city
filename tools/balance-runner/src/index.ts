import {
  balanceScenarioNames,
  isBalanceScenarioName,
  runBalance,
  type BalanceScenarioName,
} from './runner';

function integerArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  if (raw === undefined || !Number.isSafeInteger(parsed))
    throw new Error(`--${name} requires a safe integer.`);
  return parsed;
}

function scenarioArgument(): BalanceScenarioName {
  const index = process.argv.indexOf('--scenario');
  if (index === -1) return 'empty-city-opening';
  const raw = process.argv[index + 1];
  if (raw === undefined || !isBalanceScenarioName(raw)) {
    throw new Error(`--scenario requires one of ${balanceScenarioNames.join(', ')}.`);
  }
  return raw;
}

const summary = runBalance({
  seed: integerArgument('seed', 1234),
  ticks: integerArgument('ticks', 1000),
  scenario: scenarioArgument(),
});
process.stdout.write(`${JSON.stringify(summary)}\n`);
