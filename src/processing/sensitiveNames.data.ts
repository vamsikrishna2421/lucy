/**
 * Static data for on-device name detection (no LLM needed).
 *
 * COMMON_FIRST_NAMES — a gazetteer of frequent first names (Western + Indian, since
 * the user base speaks English + Telugu). Used to recognise a standalone first name
 * ("Sam", "Priya") even without a relational cue. Kept lowercase for matching.
 *
 * CAPITALIZED_STOPWORDS — capitalized words that look name-like but are NOT people
 * (months, weekdays, common places/brands, sentence-openers). Prevents over-redaction.
 */

export const COMMON_FIRST_NAMES: Set<string> = new Set([
  // Western
  'james', 'john', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas', 'charles',
  'christopher', 'daniel', 'matthew', 'anthony', 'mark', 'donald', 'steven', 'paul', 'andrew', 'joshua',
  'kenneth', 'kevin', 'brian', 'george', 'timothy', 'ronald', 'jason', 'edward', 'jeffrey', 'ryan',
  'jacob', 'gary', 'nicholas', 'eric', 'jonathan', 'stephen', 'larry', 'justin', 'scott', 'brandon',
  'sam', 'sammy', 'ben', 'benjamin', 'jack', 'luke', 'henry', 'oliver', 'noah', 'liam',
  'ethan', 'mason', 'logan', 'lucas', 'aiden', 'nathan', 'caleb', 'adam', 'aaron', 'alex',
  'alexander', 'dylan', 'tyler', 'connor', 'isaac', 'gabriel', 'owen', 'max', 'leo', 'finn',
  'mary', 'patricia', 'jennifer', 'linda', 'elizabeth', 'barbara', 'susan', 'jessica', 'sarah', 'karen',
  'nancy', 'lisa', 'betty', 'margaret', 'sandra', 'ashley', 'kimberly', 'emily', 'donna', 'michelle',
  'carol', 'amanda', 'dorothy', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia',
  'amy', 'kathleen', 'angela', 'shirley', 'anna', 'emma', 'olivia', 'ava', 'sophia', 'isabella',
  'mia', 'charlotte', 'amelia', 'evelyn', 'abigail', 'harper', 'ella', 'grace', 'chloe', 'lily',
  'zoe', 'hannah', 'natalie', 'kate', 'katie', 'rachel', 'megan', 'rose', 'ruby', 'nina',
  // Indian (common in Telugu/Hindi-speaking circles)
  'arjun', 'rohan', 'rahul', 'rohit', 'aditya', 'vikram', 'vivek', 'amit', 'anil', 'sunil',
  'ravi', 'raj', 'rajesh', 'suresh', 'ramesh', 'mahesh', 'naresh', 'ganesh', 'krishna', 'kishore',
  'srinivas', 'sai', 'teja', 'tejas', 'karthik', 'kiran', 'manoj', 'naveen', 'praveen', 'pavan',
  'sandeep', 'sachin', 'vamsi', 'vamsy', 'siddharth', 'aryan', 'ishaan', 'dev', 'kabir', 'vihaan',
  'priya', 'pooja', 'divya', 'sneha', 'swathi', 'swetha', 'sruthi', 'lakshmi', 'sita', 'gita',
  'anjali', 'aishwarya', 'deepika', 'kavya', 'meera', 'neha', 'nisha', 'riya', 'sana', 'tanvi',
  'ananya', 'aditi', 'shreya', 'pallavi', 'sravani', 'harika', 'keerthi', 'navya', 'bhavana', 'madhuri',
]);

export const CAPITALIZED_STOPWORDS: Set<string> = new Set([
  // Sentence openers / pronouns
  'i', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'we', 'they', 'he', 'she',
  'it', 'you', 'me', 'him', 'her', 'them', 'today', 'tomorrow', 'yesterday', 'tonight', 'now', 'then',
  'okay', 'ok', 'yes', 'no', 'so', 'and', 'but', 'or', 'if', 'when', 'where', 'what', 'who', 'why', 'how',
  // Months / weekdays
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  // Common places (so "London"/"India" aren't treated as people)
  'india', 'america', 'usa', 'uk', 'london', 'paris', 'tokyo', 'delhi', 'mumbai', 'hyderabad', 'bangalore',
  'chennai', 'kolkata', 'pune', 'california', 'texas', 'york', 'google', 'apple', 'amazon', 'microsoft',
  'lucy', 'whatsapp', 'instagram', 'youtube', 'spotify', 'gmail', 'uber', 'zoom',
]);
