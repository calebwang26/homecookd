// What v2's pushes say, in the recipient's language (people.language; docs/build/V2-LINKING.md §1.4). The
// languages are the ones the app's own words cover (app/src/lib/words/tr); Marathi reads as Hindi, as in the
// app, and anything else falls back to English. Drafted by Claude: TODO(caleb) a native speaker's check.
// Names and the dish go in as typed; "homecookd" stays lowercase and untranslated.

export type PushKind = "answered" | "craving" | "joined" | "filmed";
/** `relation` is how the kid names the cook ("Mom"); `name` is the person who joined. */
export type PushVars = { kid?: string; dish?: string; relation?: string; name?: string };

type Line = { title: string; body: string };
/** joinedCook and joinedKid are titles; both share the SAME_KITCHEN body. */
type Words = { answered: Line; craving: Line; joinedCook: string; joinedKid: string; filmed: Line };

const SAME_KITCHEN = {
  en: "You're in the same kitchen now.",
  hi: "अब आप एक ही रसोई में हैं।",
  es: "Ahora están en la misma cocina.",
  pt: "Agora vocês estão na mesma cozinha.",
  zh: "你们现在在同一个厨房了。",
  ko: "이제 같은 부엌에 있어요.",
  ar: "أصبحتم الآن في المطبخ نفسه.",
  ur: "اب آپ ایک ہی باورچی خانے میں ہیں۔",
  gu: "હવે તમે એક જ રસોડામાં છો.",
  pa: "ਹੁਣ ਤੁਸੀਂ ਇੱਕੋ ਰਸੋਈ ਵਿੱਚ ਹੋ।",
  ta: "இப்போது நீங்கள் ஒரே சமையலறையில் இருக்கிறீர்கள்.",
  te: "ఇప్పుడు మీరు ఒకే వంటగదిలో ఉన్నారు.",
  tl: "Nasa iisang kusina na kayo.",
};
type Lang = keyof typeof SAME_KITCHEN;

const WORDS: Record<Lang, Words> = {
  en: {
    answered: { title: "{relation} answered", body: "Tap to hear how {relation} makes {dish}." },
    craving: { title: "{kid} wants your {dish}", body: "Show {kid} how you make it." },
    joinedCook: "{name} is on homecookd",
    joinedKid: "{name} joined your kitchen",
    filmed: { title: "{relation} filmed {dish}", body: "Watch {relation} make it." },
  },
  hi: {
    answered: { title: "{relation} ने जवाब दिया", body: "सुनिए {relation} {dish} कैसे बनाते हैं।" },
    craving: { title: "{kid} को आपका {dish} चाहिए", body: "{kid} को बताइए कि आप इसे कैसे बनाते हैं।" },
    joinedCook: "{name} अब homecookd पर हैं",
    joinedKid: "{name} आपकी रसोई में शामिल हुए",
    filmed: { title: "{relation} ने {dish} का वीडियो बनाया", body: "{relation} को बनाते हुए देखिए।" },
  },
  es: {
    answered: { title: "{relation} respondió", body: "Toca para oír cómo {relation} hace {dish}." },
    craving: { title: "{kid} quiere tu {dish}", body: "Enséñale a {kid} cómo lo haces." },
    joinedCook: "{name} ya está en homecookd",
    joinedKid: "{name} se unió a tu cocina",
    filmed: { title: "{relation} grabó {dish}", body: "Mira a {relation} prepararlo." },
  },
  pt: {
    answered: { title: "{relation} respondeu", body: "Toque para ouvir como {relation} faz {dish}." },
    craving: { title: "{kid} quer o seu {dish}", body: "Mostre a {kid} como você faz." },
    joinedCook: "{name} está no homecookd",
    joinedKid: "{name} entrou na sua cozinha",
    filmed: { title: "{relation} filmou {dish}", body: "Veja {relation} preparar." },
  },
  zh: {
    answered: { title: "{relation}回复了", body: "点开听{relation}怎么做{dish}。" },
    craving: { title: "{kid}想吃你做的{dish}", body: "告诉{kid}你是怎么做的。" },
    joinedCook: "{name}加入了 homecookd",
    joinedKid: "{name}加入了你的厨房",
    filmed: { title: "{relation}拍了{dish}的视频", body: "看{relation}怎么做。" },
  },
  ko: {
    answered: { title: "{relation}이(가) 답했어요", body: "{relation}이(가) {dish} 만드는 법을 들어 보세요." },
    craving: { title: "{kid}이(가) {dish} 먹고 싶대요", body: "{kid}에게 만드는 법을 알려주세요." },
    joinedCook: "{name}이(가) homecookd에 들어왔어요",
    joinedKid: "{name}이(가) 내 부엌에 들어왔어요",
    filmed: { title: "{relation}이(가) {dish} 영상을 찍었어요", body: "{relation}이(가) 만드는 모습을 보세요." },
  },
  ar: {
    answered: { title: "ردّ {relation}", body: "اضغط لتسمع كيف يحضّر {relation} {dish}." },
    craving: { title: "{kid} يريد طبقك {dish}", body: "علّم {kid} كيف تحضّره." },
    joinedCook: "{name} الآن على homecookd",
    joinedKid: "{name} انضمّ إلى مطبخك",
    filmed: { title: "صوّر {relation} {dish}", body: "شاهد {relation} وهو يحضّره." },
  },
  ur: {
    answered: { title: "{relation} نے جواب دیا", body: "سنیں {relation} {dish} کیسے بناتے ہیں۔" },
    craving: { title: "{kid} کو آپ کا {dish} چاہیے", body: "{kid} کو بتائیں کہ آپ اسے کیسے بناتے ہیں۔" },
    joinedCook: "{name} اب homecookd پر ہیں",
    joinedKid: "{name} آپ کے باورچی خانے میں شامل ہو گئے",
    filmed: { title: "{relation} نے {dish} کی ویڈیو بنائی", body: "{relation} کو بناتے ہوئے دیکھیں۔" },
  },
  gu: {
    answered: { title: "{relation}એ જવાબ આપ્યો", body: "સાંભળો {relation} {dish} કેવી રીતે બનાવે છે." },
    craving: { title: "{kid}ને તમારું {dish} જોઈએ છે", body: "{kid}ને કહો કે તમે તે કેવી રીતે બનાવો છો." },
    joinedCook: "{name} હવે homecookd પર છે",
    joinedKid: "{name} તમારા રસોડામાં જોડાયા",
    filmed: { title: "{relation}એ {dish}નો વીડિયો બનાવ્યો", body: "{relation}ને બનાવતા જુઓ." },
  },
  pa: {
    answered: { title: "{relation} ਨੇ ਜਵਾਬ ਦਿੱਤਾ", body: "ਸੁਣੋ {relation} {dish} ਕਿਵੇਂ ਬਣਾਉਂਦੇ ਹਨ।" },
    craving: { title: "{kid} ਨੂੰ ਤੁਹਾਡਾ {dish} ਚਾਹੀਦਾ ਹੈ", body: "{kid} ਨੂੰ ਦੱਸੋ ਕਿ ਤੁਸੀਂ ਇਹ ਕਿਵੇਂ ਬਣਾਉਂਦੇ ਹੋ।" },
    joinedCook: "{name} ਹੁਣ homecookd 'ਤੇ ਹਨ",
    joinedKid: "{name} ਤੁਹਾਡੀ ਰਸੋਈ ਵਿੱਚ ਸ਼ਾਮਲ ਹੋਏ",
    filmed: { title: "{relation} ਨੇ {dish} ਦੀ ਵੀਡੀਓ ਬਣਾਈ", body: "{relation} ਨੂੰ ਬਣਾਉਂਦੇ ਵੇਖੋ।" },
  },
  ta: {
    answered: { title: "{relation} பதில் அளித்தார்", body: "{relation} {dish} எப்படி செய்கிறார் என்று கேளுங்கள்." },
    craving: { title: "{kid} உங்கள் {dish} கேட்கிறார்", body: "நீங்கள் எப்படி செய்வீர்கள் என்று {kid}-க்கு சொல்லுங்கள்." },
    joinedCook: "{name} இப்போது homecookd-இல் இருக்கிறார்",
    joinedKid: "{name} உங்கள் சமையலறையில் சேர்ந்தார்",
    filmed: { title: "{relation} {dish} வீடியோ எடுத்தார்", body: "{relation} செய்வதைப் பாருங்கள்." },
  },
  te: {
    answered: { title: "{relation} జవాబు ఇచ్చారు", body: "{relation} {dish} ఎలా చేస్తారో వినండి." },
    craving: { title: "{kid}కి మీ {dish} కావాలి", body: "మీరు ఎలా చేస్తారో {kid}కి చెప్పండి." },
    joinedCook: "{name} ఇప్పుడు homecookdలో ఉన్నారు",
    joinedKid: "{name} మీ వంటగదిలో చేరారు",
    filmed: { title: "{relation} {dish} వీడియో తీశారు", body: "{relation} చేస్తుండగా చూడండి." },
  },
  tl: {
    answered: { title: "Sumagot si {relation}", body: "Pakinggan kung paano niluluto ni {relation} ang {dish}." },
    craving: { title: "Gusto ni {kid} ang {dish} mo", body: "Ipakita kay {kid} kung paano mo ito niluluto." },
    joinedCook: "Nasa homecookd na si {name}",
    joinedKid: "Sumali si {name} sa kusina mo",
    filmed: { title: "Kinunan ni {relation} ng video ang {dish}", body: "Panoorin si {relation} habang nagluluto." },
  },
};

const STAND_IN: Record<string, Lang> = { mr: "hi" };

function langOf(code: string | undefined): Lang {
  const c = (code ?? "en").toLowerCase();
  return STAND_IN[c] ?? (c in WORDS ? (c as Lang) : "en");
}

function fill(text: string, vars: PushVars): string {
  return text.replace(/\{(kid|dish|relation|name)\}/g, (_, k: keyof PushVars) => (vars[k] ?? "").trim()).slice(0, 178);
}

/**
 * The title and body for one push. `joined` takes `to`: the cook reads "{name} is on homecookd", the kid "{name}
 * joined your kitchen". A missing name or dish falls back to English with "Your kid" / "your dish" rather than a gap.
 */
export function pushWords(kind: PushKind, language: string | undefined, vars: PushVars, to: "cook" | "kid" = "kid"): Line {
  const fallback = (kind !== "joined" && !vars.dish?.trim()) || (kind === "craving" && !vars.kid?.trim());
  const lang = fallback ? "en" : langOf(language);
  const v = fallback ? { ...vars, kid: vars.kid?.trim() || "Your kid", dish: vars.dish?.trim() || "your dish" } : vars;
  const w = WORDS[lang];
  const line: Line =
    kind === "joined"
      ? { title: to === "cook" ? w.joinedCook : w.joinedKid, body: SAME_KITCHEN[lang] }
      : w[kind];
  return { title: fill(line.title, v), body: fill(line.body, v) };
}

/** "mom" → "Mom", for the kid's words ("Mom answered"). */
export function relationLabel(relation: string | undefined): string {
  const r = (relation ?? "mom").trim();
  return r.charAt(0).toUpperCase() + r.slice(1);
}
