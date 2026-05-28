export type OutcomeId =
  | 'action-capture'
  | 'time-awareness'
  | 'spending-insights'
  | 'decisions'
  | 'ideas'
  | 'relationships'
  | 'resources-preferences'
  | 'updates-completion'
  | 'memory-questions'
  | 'privacy-boundary';

export type OutcomeExecution = 'model-comparable' | 'lucy-end-to-end' | 'local-only';

export interface OutcomeCase {
  id: string;
  outcome: OutcomeId;
  execution: OutcomeExecution;
  input: string;
  expected: string;
}

function cases(
  outcome: OutcomeId,
  execution: OutcomeExecution,
  entries: Array<[string, string]>,
): OutcomeCase[] {
  return entries.map(([input, expected], index) => ({
    id: `${outcome}-${String(index + 1).padStart(2, '0')}`,
    outcome,
    execution,
    input,
    expected,
  }));
}

export const outcomeCases: OutcomeCase[] = [
  ...cases('action-capture', 'model-comparable', [
    ['Call Maya tomorrow about renewing the apartment lease.', 'Create a call task involving Maya and the lease.'],
    ['I need to send the revised proposal to Daniel today.', 'Create a high-priority send task.'],
    ['Buy printer ink on the way home.', 'Create an errand task.'],
    ['Follow up with the recruiter next Tuesday.', 'Create a follow-up task with future context.'],
    ['Prepare the quarterly planning agenda before Friday.', 'Create a preparation task with deadline context.'],
    ['Ask Priya for the dashboard access link.', 'Create an ask/contact task involving Priya.'],
    ['I should compare internet plans this weekend.', 'Create a research task.'],
    ['Book a dentist appointment next week.', 'Create an appointment-booking task.'],
    ['Need to submit the reimbursement form.', 'Create a submission task.'],
    ['Pick up the package from reception after work.', 'Create a pickup errand task.'],
  ]),
  ...cases('time-awareness', 'model-comparable', [
    ['Remind me on May 27 2026 at 9:00 AM to submit the rent receipt.', 'Create a timed reminder.'],
    ['Tomorrow at 7 PM remind me to water the plants.', 'Create a tomorrow-evening reminder.'],
    ['The visa appointment is on June 4 2026 at 10 AM.', 'Recognize a timed appointment.'],
    ['Need to finish the draft by Friday afternoon.', 'Recognize deadline context.'],
    ['Remind me in two hours to turn off the oven.', 'Recognize near-term urgent reminder.'],
    ['At 6 AM tomorrow I need to leave for the airport.', 'Recognize time-sensitive plan.'],
    ['Pay electricity bill before the 30th.', 'Recognize due-date obligation.'],
    ['Standup moved to 9:30 AM tomorrow.', 'Recognize updated meeting time.'],
    ['Call the clinic today before 5 PM.', 'Recognize same-day time window.'],
    ['My passport renewal deadline is August 12 2026.', 'Recognize explicit deadline date.'],
  ]),
  ...cases('spending-insights', 'model-comparable', [
    ['Paid 23 dollars for groceries today.', 'Extract a food expense of 23.'],
    ['Spent 18 on a taxi to the office.', 'Extract a transport expense of 18.'],
    ['Paid 64 for dinner with friends.', 'Extract a food expense of 64.'],
    ['Bought headphones for 120.', 'Extract a shopping expense of 120.'],
    ['Paid 45 for a movie and snacks.', 'Extract an entertainment expense of 45.'],
    ['Spent 32 on fuel this morning.', 'Extract a transport expense of 32.'],
    ['Paid 900 for monthly rent.', 'Extract a housing/other expense of 900.'],
    ['Coffee was 6 dollars today.', 'Extract a food expense of 6.'],
    ['Paid 55 for the internet bill.', 'Extract a bill/other expense of 55.'],
    ['I spent 80 on books this weekend.', 'Extract a shopping expense of 80.'],
  ]),
  ...cases('decisions', 'model-comparable', [
    ['I decided to cancel my gym membership next month.', 'Capture a decision to cancel membership.'],
    ['We agreed to launch the newsletter on Monday.', 'Capture a launch decision.'],
    ['I chose Snowflake for the analytics warehouse.', 'Capture a technology decision.'],
    ['I will no longer take meetings before 9 AM.', 'Capture a personal boundary decision.'],
    ['We decided Sam will own marketing for Horizon.', 'Capture ownership decision.'],
    ['I picked the orange logo direction for LUCY.', 'Capture branding decision.'],
    ['Decided to renew the apartment lease for one year.', 'Capture lease decision.'],
    ['We are postponing the migration until testing completes.', 'Capture postponement decision.'],
    ['I chose the evening flight instead of the morning one.', 'Capture travel decision.'],
    ['I decided to save ten percent of each paycheck.', 'Capture savings decision.'],
  ]),
  ...cases('ideas', 'local-only', [
    ['Startup idea: build a private planner that connects family routines.', 'Capture a private startup idea locally only.'],
    ['Product idea: a voice journal that turns worries into action plans.', 'Capture a private product idea locally only.'],
    ['Idea for a new pricing model for my consulting service.', 'Capture confidential business idea locally only.'],
    ['A patent idea for reducing battery consumption in sensors.', 'Capture confidential invention locally only.'],
    ['I want to design a story about memories that fade selectively.', 'Capture a creative idea locally only.'],
    ['Potential business: subscription meal planning for busy parents.', 'Capture confidential business concept locally only.'],
    ['Prototype idea: detect recurring workplace blockers from notes.', 'Capture private prototype thought locally only.'],
    ['Idea for a birthday surprise involving a hidden trip.', 'Capture private personal plan locally only.'],
    ['Pitch concept: privacy-first assistant for field workers.', 'Capture private pitch concept locally only.'],
    ['New app concept called Ember for organizing personal finances.', 'Capture private app idea locally only.'],
  ]),
  ...cases('relationships', 'model-comparable', [
    ['Project Horizon involves Sam in the Marketing area.', 'Connect project Horizon, Sam, and Marketing.'],
    ['Priya is handling design for the launch project.', 'Connect Priya with design and launch.'],
    ['Daniel from finance approved the budget review.', 'Connect Daniel with finance/budget context.'],
    ['My landlord Maya asked about the lease renewal.', 'Connect Maya with lease context.'],
    ['For Data Platform, ADF feeds Snowflake each morning.', 'Connect project technologies and workflow.'],
    ['Sarah introduced me to a recruiter at Acme.', 'Connect people and organization context.'],
    ['The garden project depends on help from Ravi.', 'Connect Ravi with garden project dependency.'],
    ['Marketing needs the Horizon screenshots from design.', 'Connect areas through dependency.'],
    ['John owns the client onboarding checklist.', 'Connect John with responsibility.'],
    ['The migration project is blocked by security approval.', 'Connect project with blocker.'],
  ]),
  ...cases('resources-preferences', 'model-comparable', [
    ['Watch the dbt incremental models tutorial later.', 'Capture learning resource intent.'],
    ['Save the podcast episode about sleep and focus.', 'Capture content-to-consume intent.'],
    ['I prefer morning meetings over late afternoon calls.', 'Capture preference evidence.'],
    ['Try the new ramen place near the station someday.', 'Capture a place recommendation.'],
    ['Read the article on local-first application design.', 'Capture reading resource.'],
    ['I liked working from the quiet library today.', 'Capture location preference signal.'],
    ['Listen to the Snowflake performance podcast on my commute.', 'Capture learning resource context.'],
    ['I avoid crowded restaurants on Friday evenings.', 'Capture preference evidence.'],
    ['Visit the Brooklyn Botanic Garden this Saturday.', 'Capture place-to-visit intent.'],
    ['Remember the Python packaging video Kevin recommended.', 'Capture referenced learning content.'],
  ]),
  ...cases('updates-completion', 'lucy-end-to-end', [
    ['I need to pay the internet bill tomorrow. | Paid it.', 'Link completion to recent payment task.'],
    ['Send proposal to Daniel. | Sent it just now.', 'Complete recent send task without new pending task.'],
    ['Book dentist appointment. | Done, appointment is Tuesday.', 'Complete task and extract appointment context.'],
    ['Buy printer ink. | Bought it.', 'Complete recent errand.'],
    ['Follow up with recruiter. | She replied and asked for my resume.', 'Link response and create next action.'],
    ['Submit rent receipt. | Submitted.', 'Mark obligation complete.'],
    ['Call Maya about lease. | Spoke with Maya, she will respond Friday.', 'Link conversation and waiting state.'],
    ['Water plants tonight. | Done.', 'Complete reminder-linked action.'],
    ['Need to pay invoice. | Paid. | It was for design work.', 'Link completion and later clarification.'],
    ['Paid it.', 'Do not guess; request context if no recent compatible task exists.'],
  ]),
  ...cases('memory-questions', 'lucy-end-to-end', [
    ['What tasks and deadlines need my attention today?', 'Answer current tasks and deadlines locally.'],
    ['What is happening with Data Platform?', 'Summarize connected project memory.'],
    ['Who is connected to Horizon?', 'Return people/area connections.'],
    ['What office work keeps repeating?', 'Surface recurring work pattern.'],
    ['Summary of my payments this month?', 'Return monthly spending insight.'],
    ['What decisions have I made about the launch?', 'Surface linked decisions.'],
    ['What am I waiting on Maya for?', 'Surface waiting relationship context.'],
    ['What places have I wanted to visit?', 'Surface remembered destinations.'],
    ['What should I learn next based on my notes?', 'Yield a resource/interest insight.'],
    ['What patterns should I pay attention to this week?', 'Yield cross-memory insight with grounded evidence.'],
  ]),
  ...cases('privacy-boundary', 'local-only', [
    ['My password is ExampleOnly-4829; change it tonight.', 'Keep local and mask credential output.'],
    ['My PIN is 7391 and I need to update it.', 'Keep local and mask PIN.'],
    ['My account number is 000123456789.', 'Keep local and mask financial identifier.'],
    ['The doctor said I may need a new prescription.', 'Keep health information local.'],
    ['Therapy session raised concerns about stress at work.', 'Keep health/private information local.'],
    ['Confidential business plan for the launch is ready.', 'Keep confidential plan local.'],
    ['My private relationship issue needs attention.', 'Keep relationship detail local.'],
    ['The OTP is 847211; use it for login.', 'Keep local and mask OTP.'],
    ['Card number 4111 1111 1111 1111 was exposed.', 'Keep local and mask card data.'],
    ['Patent draft for my prototype should stay secret.', 'Keep confidential invention local.'],
  ]),
];

export const outcomeGroups = Array.from(new Set(outcomeCases.map((test) => test.outcome)));
export const remoteComparableCases = outcomeCases.filter((test) => test.execution === 'model-comparable');

export function evaluateComparableExtraction(test: OutcomeCase, result: ExtractionResult): string | null {
  switch (test.outcome) {
    case 'action-capture':
      return result.tasks.length > 0 ? null : 'No task extracted.';
    case 'time-awareness':
      return result.reminders.some((reminder) => Boolean(reminder.time))
        || result.tasks.some((task) => /\b(today|tomorrow|friday|before|deadline|due|am|pm)\b/i.test(`${task.task} ${task.context}`))
        ? null
        : 'No time-sensitive action or timed reminder extracted.';
    case 'spending-insights':
      return result.expenses.some((expense) => expense.amount.trim().length > 0)
        ? null
        : 'No expense amount extracted.';
    case 'decisions':
      return result.decisions.length > 0 ? null : 'No decision extracted.';
    case 'relationships':
      return result.projects.length + result.people.length + result.areas.length >= 2
        ? null
        : 'Insufficient related entities extracted.';
    case 'resources-preferences':
      return result.places.length + result.tasks.length + result.interests.length > 0
        ? null
        : 'No resource, place, or preference signal extracted.';
    default:
      return 'This case is not eligible for direct model comparison.';
  }
}
import type { ExtractionResult } from '../src/types/extraction';
