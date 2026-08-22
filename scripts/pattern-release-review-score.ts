#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { scoreFinishPatternReview } from "./finish-pattern-review-score.ts";

interface Args {
  key: string;
  results: string;
  out: string | null;
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = { key: "", results: "", out: null };
  for (const raw of argv) {
    const match = /^--(key|results|out)=(.+)$/.exec(raw);
    if (!match) throw new Error(`unknown argument ${raw}`);
    parsed[match[1] as keyof Args] = match[2];
  }
  if (!parsed.key || !parsed.results) {
    throw new Error(
      "usage: pattern-release-review-score.ts --key=review-key.json --results=review-results.json [--out=review-score.json]",
    );
  }
  return parsed;
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(resolve(file), "utf8")) as unknown;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const score = scoreFinishPatternReview(
    readJson(args.key),
    readJson(args.results),
  );
  const json = `${JSON.stringify(score, null, 2)}\n`;
  if (args.out) writeFileSync(resolve(args.out), json, { flag: "wx" });
  process.stdout.write(json);
  if (!score.pass) process.exitCode = 1;
}

main();
