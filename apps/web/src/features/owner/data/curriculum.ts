/**
 * The grammar taxonomy, mirroring the learner-side curriculum seed
 * (apps/api/cmd/seed/grammar/curriculum.json). Generated, not hand-written: the Owner CMS
 * must show exactly the categories and topics learners see.
 *
 * When the Go backend lands, this file is replaced by GET /api/v1/owner/grammar/curriculum.
 */

export interface CurriculumTopic {
  slug: string;
  name: string;
  description: string;
  level: string;
  cefr_levels: string[];
  estimated_minutes: number;
  ielts_relevant: boolean;
  difficulty: number;
  keywords: string[];
}

export interface CurriculumCategory {
  slug: string;
  name: string;
  description: string;
  topics: CurriculumTopic[];
}

export const grammarCurriculum: CurriculumCategory[] = [
  {
    slug: "articles",
    name: "Articles",
    description: "When to use a, an, the \u2014 or nothing at all.",
    topics: [
      { slug: "a-an", name: "A / An", description: "The indefinite article for one non-specific thing.", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.15, keywords: ["a", "an", "indefinite article", "a or an", "vowel sound"] },
      { slug: "the", name: "The", description: "The definite article for something both speakers know.", level: "A1", cefr_levels: ["A1", "A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.25, keywords: ["the", "definite article", "the article", "specific"] },
      { slug: "zero-article", name: "Zero Article", description: "When English uses no article at all.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.35, keywords: ["zero article", "no article", "without article", "plural general"] },
      { slug: "a-an-vs-the", name: "A / An vs The", description: "First mention versus something already known.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.4, keywords: ["a vs the", "an vs the", "a or the", "first mention"] },
      { slug: "articles-geographical", name: "Articles with geographical names", description: "Why it is the Alps but Mount Everest.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.55, keywords: ["the with countries", "the netherlands", "rivers", "mountains", "geographical"] },
      { slug: "articles-institutions", name: "Articles with institutions", description: "In hospital versus in the hospital.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.5, keywords: ["go to school", "in hospital", "at university", "institutions"] },
      { slug: "articles-abstract", name: "Articles with abstract nouns", description: "Abstract nouns usually take no article.", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.6, keywords: ["abstract nouns", "happiness", "the life", "love"] },
      { slug: "articles-proper", name: "Articles with proper nouns", description: "Names that take the, and names that do not.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.5, keywords: ["proper nouns", "names", "the united states", "titles"] },
    ],
  },
  {
    slug: "nouns",
    name: "Nouns",
    description: "Counting, pluralising and possessing things.",
    topics: [
      { slug: "singular-plural", name: "Singular & Plural", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.15, keywords: ["plural", "singular", "-s", "one or many"] },
      { slug: "regular-plurals", name: "Regular Plurals", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.15, keywords: ["regular plural", "add s", "es", "ies"] },
      { slug: "irregular-plurals", name: "Irregular Plurals", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.45, keywords: ["irregular plural", "children", "feet", "mice", "men"] },
      { slug: "countable-uncountable", name: "Countable & Uncountable Nouns", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.4, keywords: ["countable", "uncountable", "mass noun", "information", "advice"] },
      { slug: "possessive-nouns", name: "Possessive Nouns", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.3, keywords: ["possessive", "apostrophe s", "'s", "of"] },
      { slug: "compound-nouns", name: "Compound Nouns", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.5, keywords: ["compound noun", "two nouns", "bus stop"] },
      { slug: "collective-nouns", name: "Collective Nouns", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.55, keywords: ["collective noun", "team", "group", "family is or are"] },
    ],
  },
  {
    slug: "pronouns",
    name: "Pronouns",
    description: "Words that stand in for people and things.",
    topics: [
      { slug: "subject-pronouns", name: "Subject Pronouns", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.1, keywords: ["subject pronoun", "i you he she it we they"] },
      { slug: "object-pronouns", name: "Object Pronouns", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.15, keywords: ["object pronoun", "me him her us them"] },
      { slug: "possessive-pronouns", name: "Possessive Pronouns", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.3, keywords: ["possessive pronoun", "mine yours his hers ours theirs"] },
      { slug: "possessive-adjectives", name: "Possessive Adjectives", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.25, keywords: ["possessive adjective", "my your his her its our their"] },
      { slug: "reflexive-pronouns", name: "Reflexive Pronouns", description: "", level: "B1", cefr_levels: ["B1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.45, keywords: ["reflexive", "myself", "yourself", "themselves", "-self"] },
      { slug: "demonstrative-pronouns", name: "Demonstrative Pronouns", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.2, keywords: ["demonstrative", "this that these those"] },
      { slug: "indefinite-pronouns", name: "Indefinite Pronouns", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.5, keywords: ["indefinite pronoun", "someone", "anybody", "nothing", "everything"] },
      { slug: "relative-pronouns", name: "Relative Pronouns", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.55, keywords: ["relative pronoun", "who which that whose"] },
    ],
  },
  {
    slug: "determiners",
    name: "Determiners & Quantifiers",
    description: "How much, how many and which one.",
    topics: [
      { slug: "this-that-these-those", name: "This / That / These / Those", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.2, keywords: ["this that these those", "near far", "demonstrative determiner"] },
      { slug: "some-any", name: "Some / Any", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.3, keywords: ["some", "any", "some or any", "questions negatives"] },
      { slug: "much-many", name: "Much / Many", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.35, keywords: ["much", "many", "much or many", "how much how many"] },
      { slug: "few-little", name: "Few / Little", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.6, keywords: ["few", "little", "few or little", "not enough"] },
      { slug: "a-few-a-little", name: "A Few / A Little", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.6, keywords: ["a few", "a little", "a few vs few", "some"] },
      { slug: "each-every", name: "Each / Every", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.55, keywords: ["each", "every", "each or every"] },
      { slug: "both-either-neither", name: "Both / Either / Neither", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["both", "either", "neither", "two things"] },
      { slug: "all-whole", name: "All / Whole", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.6, keywords: ["all", "whole", "all the or the whole"] },
      { slug: "enough", name: "Enough", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.4, keywords: ["enough", "not enough", "too"] },
      { slug: "several", name: "Several", description: "", level: "B1", cefr_levels: ["B1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.45, keywords: ["several", "a number of", "more than a few"] },
    ],
  },
  {
    slug: "tenses",
    name: "Tenses & Aspects",
    description: "When an action happens, and how it is seen.",
    topics: [
      { slug: "present-simple", name: "Present Simple", description: "Habits, routines and facts.", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.2, keywords: ["present simple", "habits", "routines", "facts", "do does", "third person s"] },
      { slug: "present-continuous", name: "Present Continuous", description: "Actions happening now or around now.", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.3, keywords: ["present continuous", "present progressive", "-ing", "am is are", "right now"] },
      { slug: "present-perfect", name: "Present Perfect", description: "Past actions connected to now.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 18, ielts_relevant: true, difficulty: 0.6, keywords: ["present perfect", "have has", "been", "ever never", "already yet", "experience"] },
      { slug: "present-perfect-continuous", name: "Present Perfect Continuous", description: "How long something has been going on.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.7, keywords: ["present perfect continuous", "have been -ing", "for since", "duration"] },
      { slug: "past-simple", name: "Past Simple", description: "Finished actions at a definite past time.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.35, keywords: ["past simple", "past tense", "v2", "did", "didn't", "yesterday", "second form"] },
      { slug: "past-continuous", name: "Past Continuous", description: "An action in progress at a past moment.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.45, keywords: ["past continuous", "past progressive", "was were -ing", "while", "interrupted"] },
      { slug: "past-perfect", name: "Past Perfect", description: "The past before the past.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.65, keywords: ["past perfect", "had done", "v3", "before that", "earlier past"] },
      { slug: "past-perfect-continuous", name: "Past Perfect Continuous", description: "How long something had been going on.", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.75, keywords: ["past perfect continuous", "had been -ing", "duration before past"] },
      { slug: "future-will", name: "Will", description: "Predictions, offers and instant decisions.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["will", "future", "won't", "predictions", "decisions", "shall"] },
      { slug: "be-going-to", name: "Be Going To", description: "Plans and things you can already see coming.", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["going to", "gonna", "plans", "intentions", "evidence"] },
      { slug: "present-continuous-future", name: "Present Continuous for Future", description: "Fixed arrangements already in the diary.", level: "B1", cefr_levels: ["B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.5, keywords: ["present continuous future", "arrangements", "diary", "fixed plans"] },
      { slug: "future-continuous", name: "Future Continuous", description: "In progress at a moment in the future.", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.65, keywords: ["future continuous", "will be -ing", "this time tomorrow"] },
      { slug: "future-perfect", name: "Future Perfect", description: "Finished before a future point.", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.75, keywords: ["future perfect", "will have done", "by then", "by 2030"] },
      { slug: "future-perfect-continuous", name: "Future Perfect Continuous", description: "Duration up to a future point.", level: "C1", cefr_levels: ["C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.85, keywords: ["future perfect continuous", "will have been -ing"] },
    ],
  },
  {
    slug: "modals",
    name: "Modal Verbs",
    description: "Ability, obligation, advice and possibility.",
    topics: [
      { slug: "can-could", name: "Can / Could", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 12, ielts_relevant: false, difficulty: 0.25, keywords: ["can", "could", "ability", "permission", "requests"] },
      { slug: "may-might", name: "May / Might", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.55, keywords: ["may", "might", "possibility", "maybe", "perhaps"] },
      { slug: "must", name: "Must", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.4, keywords: ["must", "obligation", "mustn't", "certainty"] },
      { slug: "have-to", name: "Have To", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.4, keywords: ["have to", "had to", "don't have to", "external obligation"] },
      { slug: "should", name: "Should", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.35, keywords: ["should", "shouldn't", "advice", "ought"] },
      { slug: "ought-to", name: "Ought To", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.6, keywords: ["ought to", "should", "advice"] },
      { slug: "need-neednt", name: "Need / Needn't", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.65, keywords: ["need", "needn't", "don't need to", "necessity"] },
      { slug: "would", name: "Would", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.55, keywords: ["would", "'d", "hypothetical", "polite requests", "used to"] },
      { slug: "shall", name: "Shall", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.6, keywords: ["shall", "offers", "suggestions", "formal future"] },
      { slug: "modal-perfects", name: "Modal Perfects", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.8, keywords: ["must have", "should have", "could have", "might have", "modal perfect", "regret"] },
    ],
  },
  {
    slug: "verbs",
    name: "Verbs",
    description: "How verbs behave before tense gets involved.",
    topics: [
      { slug: "regular-irregular-verbs", name: "Regular / Irregular Verbs", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 12, ielts_relevant: false, difficulty: 0.3, keywords: ["irregular verbs", "regular verbs", "-ed", "v2 v3", "verb forms", "went gone"] },
      { slug: "transitive-intransitive", name: "Transitive / Intransitive Verbs", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.65, keywords: ["transitive", "intransitive", "object", "verb patterns"] },
      { slug: "state-action-verbs", name: "State / Action Verbs", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["state verbs", "action verbs", "dynamic", "non-continuous"] },
      { slug: "stative-verbs", name: "Stative Verbs", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["stative verbs", "know like want", "not continuous", "i'm loving it"] },
      { slug: "phrasal-verbs", name: "Phrasal Verbs", description: "", level: "B1", cefr_levels: ["B1", "B2", "C1"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.7, keywords: ["phrasal verbs", "give up", "look after", "separable", "particle"] },
      { slug: "causative-verbs", name: "Causative Verbs", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.75, keywords: ["causative", "have something done", "get something done", "make let"] },
    ],
  },
  {
    slug: "adjectives",
    name: "Adjectives",
    description: "Describing things, and comparing them.",
    topics: [
      { slug: "adjective-order", name: "Adjective Order", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.6, keywords: ["adjective order", "order of adjectives", "big old red"] },
      { slug: "comparative-adj", name: "Comparative", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["comparative", "-er", "more than", "bigger"] },
      { slug: "superlative-adj", name: "Superlative", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["superlative", "-est", "the most", "best"] },
      { slug: "participial-adjectives", name: "Participial Adjectives", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["-ing adjectives", "-ed adjectives", "boring bored", "interesting interested"] },
      { slug: "compound-adjectives", name: "Compound Adjectives", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.65, keywords: ["compound adjective", "well-known", "hyphen", "two-year-old"] },
    ],
  },
  {
    slug: "adverbs",
    name: "Adverbs",
    description: "How, when, where and how much.",
    topics: [
      { slug: "adverbs-frequency", name: "Adverbs of Frequency", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.3, keywords: ["always", "usually", "sometimes", "never", "frequency", "how often"] },
      { slug: "adverbs-manner", name: "Adverbs of Manner", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.35, keywords: ["adverbs of manner", "-ly", "quickly", "carefully", "how"] },
      { slug: "adverbs-place", name: "Adverbs of Place", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.3, keywords: ["adverbs of place", "here there everywhere"] },
      { slug: "adverbs-time", name: "Adverbs of Time", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.3, keywords: ["adverbs of time", "yesterday", "soon", "already"] },
      { slug: "adverbs-degree", name: "Adverbs of Degree", description: "", level: "B1", cefr_levels: ["B1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.5, keywords: ["adverbs of degree", "very", "quite", "extremely", "too"] },
      { slug: "sentence-adverbs", name: "Sentence Adverbs", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.7, keywords: ["sentence adverbs", "fortunately", "obviously", "however"] },
      { slug: "position-of-adverbs", name: "Position of Adverbs", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.6, keywords: ["adverb position", "word order adverbs", "mid position"] },
    ],
  },
  {
    slug: "prepositions",
    name: "Prepositions",
    description: "The small words that decide the meaning.",
    topics: [
      { slug: "prepositions-time", name: "Prepositions of Time", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.3, keywords: ["in on at time", "prepositions of time", "at 5", "on monday", "in july"] },
      { slug: "prepositions-place", name: "Prepositions of Place", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.3, keywords: ["in on at place", "prepositions of place", "under", "between"] },
      { slug: "prepositions-movement", name: "Prepositions of Movement", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.4, keywords: ["prepositions of movement", "to into", "across", "through"] },
      { slug: "prepositions-after-verbs", name: "Prepositions after Verbs", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.7, keywords: ["dependent prepositions", "depend on", "listen to", "verb preposition"] },
      { slug: "prepositions-after-adjectives", name: "Prepositions after Adjectives", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.7, keywords: ["adjective preposition", "good at", "interested in", "afraid of"] },
      { slug: "prepositional-phrases", name: "Prepositional Phrases", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.7, keywords: ["prepositional phrase", "in advance", "on time", "by chance"] },
    ],
  },
  {
    slug: "conjunctions",
    name: "Conjunctions",
    description: "Joining ideas into one sentence.",
    topics: [
      { slug: "and-but-or", name: "And / But / Or", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.15, keywords: ["and", "but", "or", "linking words"] },
      { slug: "because-so", name: "Because / So", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.3, keywords: ["because", "so", "reason", "result", "cause"] },
      { slug: "although-though", name: "Although / Though", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["although", "though", "even though", "contrast", "concession"] },
      { slug: "while-whereas", name: "While / Whereas", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.65, keywords: ["while", "whereas", "contrast", "comparing"] },
      { slug: "unless-conj", name: "Unless", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.65, keywords: ["unless", "if not", "condition"] },
      { slug: "since-conj", name: "Since", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.6, keywords: ["since", "because", "from a time", "for since"] },
      { slug: "as-conj", name: "As", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.7, keywords: ["as", "because", "while", "like or as"] },
      { slug: "despite-in-spite-of", name: "Despite / In Spite Of", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.7, keywords: ["despite", "in spite of", "although", "contrast", "despite of"] },
    ],
  },
  {
    slug: "conditionals",
    name: "Conditionals",
    description: "Real and imagined situations with if.",
    topics: [
      { slug: "zero-conditional", name: "Zero Conditional", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.4, keywords: ["zero conditional", "if present present", "facts", "always true"] },
      { slug: "first-conditional", name: "First Conditional", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.45, keywords: ["first conditional", "if will", "real future", "1st conditional"] },
      { slug: "second-conditional", name: "Second Conditional", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.65, keywords: ["second conditional", "if past would", "imaginary", "2nd conditional", "if i were"] },
      { slug: "third-conditional", name: "Third Conditional", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.8, keywords: ["third conditional", "if had would have", "regret", "past unreal", "3rd conditional"] },
      { slug: "mixed-conditionals", name: "Mixed Conditionals", description: "", level: "C1", cefr_levels: ["C1", "C2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.9, keywords: ["mixed conditional", "past condition present result"] },
      { slug: "unless-cond", name: "Unless in conditionals", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.65, keywords: ["unless", "if not", "negative condition"] },
      { slug: "provided-providing", name: "Provided / Providing", description: "", level: "C1", cefr_levels: ["C1"], estimated_minutes: 6, ielts_relevant: true, difficulty: 0.85, keywords: ["provided that", "providing", "on condition that"] },
      { slug: "as-long-as", name: "As Long As", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 6, ielts_relevant: true, difficulty: 0.7, keywords: ["as long as", "so long as", "condition"] },
    ],
  },
  {
    slug: "passive",
    name: "Passive Voice",
    description: "Putting the action, not the doer, first.",
    topics: [
      { slug: "present-passive", name: "Present Passive", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.6, keywords: ["present passive", "is made", "are done", "passive present simple"] },
      { slug: "past-passive", name: "Past Passive", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.6, keywords: ["past passive", "was built", "were made"] },
      { slug: "future-passive", name: "Future Passive", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.7, keywords: ["future passive", "will be done"] },
      { slug: "modal-passive", name: "Modal Passive", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.75, keywords: ["modal passive", "must be done", "can be seen"] },
      { slug: "perfect-passive", name: "Perfect Passive", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.8, keywords: ["perfect passive", "has been done", "had been built"] },
      { slug: "get-passive", name: "Get Passive", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.75, keywords: ["get passive", "got broken", "informal passive"] },
    ],
  },
  {
    slug: "reported-speech",
    name: "Reported Speech",
    description: "Saying what someone else said.",
    topics: [
      { slug: "reported-statements", name: "Reported Statements", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.65, keywords: ["reported speech", "indirect speech", "he said that", "told me"] },
      { slug: "reported-questions", name: "Reported Questions", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.7, keywords: ["reported questions", "asked if", "indirect question", "word order"] },
      { slug: "reported-commands", name: "Reported Commands", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.65, keywords: ["reported commands", "told me to", "asked me to"] },
      { slug: "backshift", name: "Backshift", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.75, keywords: ["backshift", "tense change", "said", "one tense back"] },
      { slug: "reporting-verbs", name: "Reporting Verbs", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.8, keywords: ["reporting verbs", "admit", "suggest", "refuse", "claim"] },
    ],
  },
  {
    slug: "relative-clauses",
    name: "Relative Clauses",
    description: "Adding information inside a sentence.",
    topics: [
      { slug: "defining-relative", name: "Defining Relative Clauses", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.6, keywords: ["defining relative clause", "who which that", "identifying", "no commas"] },
      { slug: "non-defining-relative", name: "Non-defining Relative Clauses", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.75, keywords: ["non-defining", "commas", "extra information", "which"] },
      { slug: "who-which-that", name: "Who / Which / That", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.55, keywords: ["who", "which", "that", "which or that"] },
      { slug: "whose", name: "Whose", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.6, keywords: ["whose", "possessive relative"] },
      { slug: "where-when", name: "Where / When", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.55, keywords: ["where", "when", "relative adverbs", "the place where"] },
      { slug: "reduced-relative", name: "Reduced Relative Clauses", description: "", level: "C1", cefr_levels: ["C1", "C2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.9, keywords: ["reduced relative", "participle clause", "the man standing"] },
    ],
  },
  {
    slug: "gerunds-infinitives",
    name: "Gerunds & Infinitives",
    description: "When a verb becomes -ing, and when it takes to.",
    topics: [
      { slug: "gerunds", name: "Gerunds", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.6, keywords: ["gerund", "-ing", "verb as noun", "swimming is"] },
      { slug: "infinitives", name: "Infinitives", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.6, keywords: ["infinitive", "to do", "to + verb"] },
      { slug: "verb-gerund", name: "Verb + Gerund", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.65, keywords: ["enjoy doing", "avoid", "finish", "verb + ing"] },
      { slug: "verb-infinitive", name: "Verb + Infinitive", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.65, keywords: ["want to", "decide to", "hope to", "verb + infinitive"] },
      { slug: "verb-object-infinitive", name: "Verb + Object + Infinitive", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.75, keywords: ["tell someone to", "want someone to", "ask him to"] },
      { slug: "gerund-vs-infinitive", name: "Gerund vs Infinitive", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 15, ielts_relevant: true, difficulty: 0.8, keywords: ["gerund vs infinitive", "stop doing stop to", "remember doing", "-ing or to"] },
    ],
  },
  {
    slug: "comparisons",
    name: "Comparisons",
    description: "More, less, and the same.",
    topics: [
      { slug: "comparative", name: "Comparative", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["comparative", "-er than", "more than"] },
      { slug: "superlative", name: "Superlative", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.35, keywords: ["superlative", "the most", "-est", "the best"] },
      { slug: "as-as", name: "As ... As", description: "", level: "B1", cefr_levels: ["B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.5, keywords: ["as as", "as tall as", "not as as", "same"] },
      { slug: "less-fewer", name: "Less / Fewer", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.65, keywords: ["less", "fewer", "less or fewer", "countable"] },
      { slug: "more-most", name: "More / Most", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.4, keywords: ["more", "most", "more than"] },
      { slug: "the-the", name: "The ... The ...", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.8, keywords: ["the more the better", "double comparative", "the the"] },
    ],
  },
  {
    slug: "questions-negation",
    name: "Questions & Negation",
    description: "Asking, and saying no.",
    topics: [
      { slug: "yes-no-questions", name: "Yes / No Questions", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.2, keywords: ["yes no questions", "do you", "are you", "auxiliary"] },
      { slug: "wh-questions", name: "Wh Questions", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.25, keywords: ["wh questions", "what where when why how", "question words"] },
      { slug: "question-tags", name: "Question Tags", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.7, keywords: ["question tags", "isn't it", "don't you", "tag questions"] },
      { slug: "indirect-questions", name: "Indirect Questions", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 12, ielts_relevant: true, difficulty: 0.7, keywords: ["indirect questions", "could you tell me", "polite questions", "word order"] },
      { slug: "negative-forms", name: "Negative Forms", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.25, keywords: ["negative", "don't", "doesn't", "not", "didn't"] },
      { slug: "double-negatives", name: "Double Negatives", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.6, keywords: ["double negative", "don't know nothing"] },
    ],
  },
  {
    slug: "sentence-structure",
    name: "Sentence Structure",
    description: "What a sentence is made of.",
    topics: [
      { slug: "subject", name: "Subject", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.2, keywords: ["subject", "who does it"] },
      { slug: "predicate", name: "Predicate", description: "", level: "A2", cefr_levels: ["A2"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.35, keywords: ["predicate", "verb phrase"] },
      { slug: "objects", name: "Objects", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.45, keywords: ["object", "direct object", "indirect object"] },
      { slug: "complements", name: "Complements", description: "", level: "B2", cefr_levels: ["B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.7, keywords: ["complement", "subject complement", "linking verb"] },
      { slug: "simple-sentences", name: "Simple Sentences", description: "", level: "A1", cefr_levels: ["A1"], estimated_minutes: 6, ielts_relevant: false, difficulty: 0.2, keywords: ["simple sentence", "one clause"] },
      { slug: "compound-sentences", name: "Compound Sentences", description: "", level: "B1", cefr_levels: ["B1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.5, keywords: ["compound sentence", "and but so", "two clauses"] },
      { slug: "complex-sentences", name: "Complex Sentences", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["complex sentence", "subordinate clause", "because although"] },
      { slug: "compound-complex", name: "Compound-Complex Sentences", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 8, ielts_relevant: true, difficulty: 0.8, keywords: ["compound complex sentence"] },
    ],
  },
  {
    slug: "clauses",
    name: "Clauses",
    description: "The building blocks inside a sentence.",
    topics: [
      { slug: "noun-clauses", name: "Noun Clauses", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.75, keywords: ["noun clause", "that clause", "what he said"] },
      { slug: "adverbial-clauses", name: "Adverbial Clauses", description: "", level: "B2", cefr_levels: ["B2", "C1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.75, keywords: ["adverbial clause", "when because although"] },
      { slug: "relative-clauses-overview", name: "Relative Clauses", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.6, keywords: ["relative clause", "who which that"] },
      { slug: "conditional-clauses", name: "Conditional Clauses", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.65, keywords: ["conditional clause", "if clause"] },
    ],
  },
  {
    slug: "word-order",
    name: "Word Order",
    description: "The order English insists on.",
    topics: [
      { slug: "basic-word-order", name: "Basic Word Order", description: "", level: "A1", cefr_levels: ["A1", "A2"], estimated_minutes: 10, ielts_relevant: false, difficulty: 0.25, keywords: ["word order", "svo", "subject verb object"] },
      { slug: "adjective-order-wo", name: "Adjective Order", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.6, keywords: ["adjective order", "order of adjectives"] },
      { slug: "adverb-position", name: "Adverb Position", description: "", level: "B1", cefr_levels: ["B1", "B2"], estimated_minutes: 8, ielts_relevant: false, difficulty: 0.6, keywords: ["adverb position", "where to put adverbs"] },
      { slug: "question-word-order", name: "Question Word Order", description: "", level: "A2", cefr_levels: ["A2", "B1"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.4, keywords: ["question word order", "auxiliary first", "inversion questions"] },
      { slug: "inversion", name: "Inversion", description: "", level: "C1", cefr_levels: ["C1", "C2"], estimated_minutes: 10, ielts_relevant: true, difficulty: 0.9, keywords: ["inversion", "never have i", "not only", "emphatic"] },
    ],
  },
];

export const grammarCategoryNames: Record<string, string> = Object.fromEntries(
  grammarCurriculum.map((c) => [c.slug, c.name]),
);
