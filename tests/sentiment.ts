/* Pure tests for on-device sentiment. Run: npx tsx tests/sentiment.ts */
import { analyzeSentiment, isDefaultMood } from '../src/processing/sentiment';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

ok('stressed detected', analyzeSentiment('so stressed about the deadline, too much work').tone === 'stressed');
ok('excited detected', analyzeSentiment("can't wait, we finally shipped it!!").tone === 'excited');
ok('negative detected', analyzeSentiment('feeling really down and lonely today').tone === 'negative');
ok('frustrated detected', analyzeSentiment('ugh the build is broken again, so annoyed').tone === 'frustrated');
ok('positive detected', analyzeSentiment('had a great day, feeling grateful and proud').tone === 'positive');
ok('calm detected', analyzeSentiment('relaxed evening, feeling calm and rested').tone === 'calm');
ok('neutral when no signal', analyzeSentiment('buy milk and paper towels').tone === 'neutral');
ok('neutral has zero confidence', analyzeSentiment('update the spreadsheet').confidence === 0);
ok('signal has confidence', analyzeSentiment('stressed and overwhelmed').confidence > 0);

// energy
ok('high energy on excitement', analyzeSentiment("pumped, can't wait!!").energy === 'high');
ok('low energy on tiredness', analyzeSentiment('exhausted and drained today').energy === 'low');
ok('medium energy default', analyzeSentiment('buy milk').energy === 'medium');

// default-mood guard
ok('bare neutral is default', isDefaultMood({ tone: 'neutral', energy: 'medium' }));
ok('null is default', isDefaultMood(null));
ok('real mood not default', !isDefaultMood({ tone: 'stressed', energy: 'high' }));

console.log(`\nsentiment: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
