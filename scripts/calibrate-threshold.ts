/**
 * Measures the similarity distribution for semantic dashboard search.
 *
 *   NODE_OPTIONS="--require ./scripts/allow-server-only.cjs" npx tsx scripts/calibrate-threshold.ts
 *
 * Embedding similarity has a high floor — unrelated text does not score near
 * zero — so the cutoff separating "about this" from "unrelated" has to be
 * measured against the actual model rather than guessed.
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const SUMMARY =
  'An employment agreement dated 14 March 2024 between Northwind Analytics Ltd and ' +
  'Priya Raghunathan as Senior Data Engineer, with a gross annual salary of GBP 78,500 ' +
  'reviewed each April and a discretionary bonus up to 15%. It sets 27 days annual leave, ' +
  '37.5 hour weeks with up to three remote days, and a three-month notice period after a ' +
  'six-month probation. Confidentiality and IP assignment clauses apply, with six-month ' +
  'non-solicitation restrictions after termination.';

const RELATED = [
  'employment contract',
  'confidentiality obligations',
  'salary and bonus terms',
  'notice period',
  'non-compete clause',
  'staff holiday policy',
];

const UNRELATED = [
  'pizza recipes',
  'how to fix a bicycle puncture',
  'quantum computing tutorial',
  'tomorrow weather forecast',
  'best hiking trails in Nepal',
  'javascript array methods',
];

async function main() {
  const { embedQuery, embedDocumentDescriptor } = await import('../src/server/ai/embed');

  const doc = await embedDocumentDescriptor('Agreement_v3.pdf', SUMMARY);
  // Both sides are unit-normalised, so the dot product is the cosine similarity.
  const cosine = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

  const score = async (q: string) => cosine(await embedQuery(q), doc);

  console.log('RELATED — should rank above the cutoff:');
  const related: number[] = [];
  for (const q of RELATED) {
    const s = await score(q);
    related.push(s);
    console.log(`  ${s.toFixed(3)}  ${q}`);
  }

  console.log('\nUNRELATED — should fall below the cutoff:');
  const unrelated: number[] = [];
  for (const q of UNRELATED) {
    const s = await score(q);
    unrelated.push(s);
    console.log(`  ${s.toFixed(3)}  ${q}`);
  }

  const minRelated = Math.min(...related);
  const maxUnrelated = Math.max(...unrelated);

  console.log(`\nmin related   = ${minRelated.toFixed(3)}`);
  console.log(`max unrelated = ${maxUnrelated.toFixed(3)}`);
  console.log(`separation    = ${(minRelated - maxUnrelated).toFixed(3)}`);
  console.log(
    `\nsuggested threshold = ${((minRelated + maxUnrelated) / 2).toFixed(2)} (midpoint)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
