// NFR18 — the rule layer of the safety filter, run on every question BEFORE
// any AI call. OpenAI moderation (services/ai/moderation.js) is the second
// layer; the grounded system prompt (prompt.js) is the third.
//
//   checkQuestion(text) → null                       nothing matched, carry on
//                       → { kind: 'greeting', reply }  answer politely, no AI call
//                       → { kind: 'refused', reason, reply }
//
// A refusal is a normal chat reply, not an HTTP error: the user sees a polite
// explanation in the conversation.
//
// The rules are deliberately narrow. A missed off-topic question still ends
// in "I couldn't find this in the SOPs" (retrieval finds nothing relevant),
// whereas a rule that is too broad would block real training questions — for
// example, SOPs legitimately discuss hijacking, fire and dangerous goods.

const REPLIES = Object.freeze({
  injection: "I can only answer questions about Royal Jordanian SOPs and training, and I can't change how I work. Please ask about a procedure.",
  harmful: "I can't help with that. If you have a question about a Royal Jordanian procedure or your training, I'm happy to help.",
  off_topic: "I'm the Royal Jordanian training assistant, so I can only answer questions about company SOPs and your training. Try asking about a procedure, for example how to check a smoke hood before a flight.",
  greeting: "Hello! I'm the Royal Jordanian training assistant. Ask me anything about company SOPs, for example what to do if a smoke hood indicator has turned pink, and I'll answer with the source.",
  thanks: "You're welcome! Ask me anything else about company SOPs whenever you need.",
});

// Attempts to override the system prompt, change the bot's role, or read
// its instructions.
const INJECTION_RULES = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b[^.?!\n]{0,40}\b(instructions?|rules|prompts?|guidelines|directions|guardrails|restrictions)\b/,
  /\b(reveal|show|print|repeat|display|output|leak|tell me|what (is|are|was|were))\b[^.?!\n]{0,30}\b(system|hidden|initial|original|secret|developer)\s+(prompt|instructions?|message|rules)\b/,
  /\byour (system )?(prompt|instructions)\b[^.?!\n]{0,20}\b(verbatim|word for word|exactly)\b/,
  /\byou are (now|no longer)\b/,
  /\b(pretend|act|behave|roleplay|role-play)\b[^.?!\n]{0,15}\b(as|like|to be)\b[^.?!\n]{0,25}\b(unrestricted|unfiltered|uncensored|jailbroken|evil|dan|different (ai|assistant|bot|model))\b/,
  /\b(jailbreak|jail-break|dan mode|developer mode|god mode|do anything now)\b/,
  /\bnew (instructions|rules|persona|system prompt)\s*:/,
  /<\/?\s*(system|assistant|instructions?|excerpts?)\s*>/,
  /^\s*(system|assistant)\s*:/m,
];

// Clearly harmful requests. Questions ABOUT these topics in a safety
// context ("what is the hijack procedure?") are not matched.
const HARMFUL_RULES = [
  /\b(how (do|can|could|would|should) (i|we|you|someone|one)|how to|ways? to|help me|teach me)\b[^.?!\n]{0,40}\b(make|build|assemble|hide|smuggle|sneak|bring|carry)\b[^.?!\n]{0,30}\b(bombs?|explosives?|ieds?|weapons?|guns?|firearms?|knives|knife)\b/,
  /\b(bypass|evade|get (past|around|through)|sneak (past|through)|fool|trick)\b[^.?!\n]{0,25}\b(airport security|security (check|checkpoint|screening)s?|screening|metal detectors?|x-?ray|body scanners?|customs)\b/,
  /\bhow (do|can|could|would|to) (i|we|someone|one)?\s*(hijack|sabotage)\b/,
  /\b(hack|break) into\b/,
  /\b(steal|crack)\b[^.?!\n]{0,20}\b(passwords?|credentials|accounts?)\b/,
];

// Requests that are obviously not about RJ procedures or training.
const OFF_TOPIC_RULES = [
  /\b(write|compose|generate|create|make)\b[^.?!\n]{0,20}\b(poem|song|lyrics|story|essay|rap|haiku|limerick)\b/,
  /\btell me a (joke|story)\b/,
  /\b(write|generate|debug|fix)\b[^.?!\n]{0,25}\b(code|script|program|function|sql query|regex|html|javascript|python)\b/,
  /\b(recipes?|horoscope|lottery|stock (tips?|prices?)|bitcoin|cryptocurrenc(y|ies)|movie recommendations?)\b/,
  /\b(do my|solve my|answer my)\b[^.?!\n]{0,15}\b(homework|assignment|exam)\b/,
];

const GREETING_RE = /^(hi|hello|hey|hiya|salam|salaam|marhaba|ahlan|good (morning|afternoon|evening))( there)?[\s!.,]*$/;
const THANKS_RE = /^(thanks|thank you|thx|thanks a lot|thank you so much|great,? thanks?)[\s!.,]*$/;

function normalise(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function checkQuestion(text) {
  const t = normalise(text);
  if (GREETING_RE.test(t)) return { kind: 'greeting', reply: REPLIES.greeting };
  if (THANKS_RE.test(t)) return { kind: 'greeting', reply: REPLIES.thanks };
  if (INJECTION_RULES.some(re => re.test(t))) return { kind: 'refused', reason: 'injection', reply: REPLIES.injection };
  if (HARMFUL_RULES.some(re => re.test(t))) return { kind: 'refused', reason: 'harmful', reply: REPLIES.harmful };
  if (OFF_TOPIC_RULES.some(re => re.test(t))) return { kind: 'refused', reason: 'off_topic', reply: REPLIES.off_topic };
  return null;
}

module.exports = { checkQuestion, REPLIES };
