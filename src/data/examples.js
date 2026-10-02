// Hand-written example analyses, shown without calling the API or using quota.
//
// These are NOT saved tool output. Google's grounding terms only allow a
// grounded answer to be shown to the person who asked for it, and forbid
// storing or editing it, so a saved live result can't be shown to other
// visitors. Instead these were written by hand from the listed pages, in the
// same shape as a live analysis, and every claim was checked against the
// source it cites. Figures keep the scope their source gives them.
//
// Citations are 0-based indexes into each example's `sources`.

export const EXAMPLES_WRITTEN_ON = "1 October 2026";

export const EXAMPLES = [
  {
    id: "dove-real-beauty-2004",
    label: "Dove · Campaign for Real Beauty",
    year: 2004,
    analysis: {
      matchedCampaign: { brand: "Dove", name: "Campaign for Real Beauty", year: 2004 },
      confidence: "High",
      confidenceReason:
        "Well documented: several independent sources cover the campaign, and published figures exist for sales, earned media and awards.",
      context:
        "Research behind the campaign found that only 4% of women considered themselves beautiful. Beauty advertising at the time relied on professional models, and Dove set out to take the opposite position.",
      objective:
        "Build self-confidence in women and girls by widening what counts as beautiful, and give Dove a distinct, ownable position in a crowded category.",
      whatTheyDid: {
        idea:
          "The launch billboards, first in Germany and the UK, showed photographs of ordinary women instead of models and asked passers-by to vote on captions such as “Fat or Fab” and “Wrinkled or Wonderful”, with the running tally shown on the billboard. The platform grew into short films, including Daughters and Evolution in 2006.",
        channels: [
          "Interactive billboards",
          "Short films (Daughters, Evolution)",
          "Campaign microsite",
          "Dove Self-Esteem Project education programme",
        ],
        audience: "Women and girls, with the Self-Esteem Project aimed at young people.",
      },
      results: {
        available: true,
        items: [
          "Ad Age reported that sales of Dove soap rose from $2 billion to $4 billion in the three years after launch.",
          "Unilever estimated the exposure the campaign generated was worth more than 30 times the paid-for media space.",
          "The Evolution film (2006) won both the Film Grand Prix and the Cyber Grand Prix at Cannes Lions in 2007.",
          "The early campaign microsite drew a reported 1.5 million visitors.",
          "Sales of Dove firming lotion in the UK rose by 700%, according to a published case-study deck. This covers one product in one market, not Dove's sales overall.",
          "The Dove Self-Esteem Project, part of the same Real Beauty platform, has educated more than 100 million young people on body confidence, towards a goal of 250 million by 2030. This is a cumulative, long-term total, not a 2004 result.",
        ],
      },
      reception: {
        praise: [
          "Ad Age ranked it No. 1 in its list of the Top Ad Campaigns of the 21st Century.",
          "The Evolution film spread widely online and drew strong reactions from the public and the press.",
        ],
        criticism: [
          "Unilever, Dove's parent company, also owned Axe/Lynx, whose ads used overtly sexualised images of women, which critics said contradicted the Real Beauty message.",
          "Unilever also sold Fair & Lovely, a skin-lightening product, which added to accusations of hypocrisy.",
          "Critics argued the campaign still made beauty the measure of a woman's worth, and one said it subtly blamed women for insecurities the beauty industry helped create.",
          "A photo retoucher publicly questioned how much retouching went into some of the “real women” images.",
        ],
        backlash:
          "A later Dove ad, a 2017 Facebook video in which a Black woman appeared to turn into a white woman, was widely called racially insensitive. It came well after the 2004 launch but is often discussed alongside the platform.",
      },
      verdict: {
        rating: "Success",
        evidence: [
          "Ad Age reported Dove soap sales rising from $2 billion to $4 billion in three years.",
          "Unilever estimated earned exposure at more than 30 times the paid media space.",
          "Evolution won the Film and Cyber Grand Prix at Cannes Lions 2007.",
          "Ad Age ranked it the No. 1 ad campaign of the 21st century.",
        ],
        interpretation:
          "On the documented outcomes (sales growth, earned media far beyond the paid budget, and top industry awards) this was a clear commercial and cultural success. The criticism is real and lasting, but it mostly concerns Unilever's wider portfolio and later executions rather than the 2004 campaign's own results.",
        split: [],
      },
      lessons: [
        "A specific, research-backed insight (only 4% of women called themselves beautiful) can carry a campaign for years.",
        "Inviting the audience to take part, as the voting billboards did, earns attention that paid media alone can't buy.",
        "A purpose-led message is judged against everything the parent company does, so check the whole portfolio before you lead with values.",
      ],
      sources: [
        { title: "Wikipedia: Dove Campaign for Real Beauty", uri: "https://en.wikipedia.org/wiki/Dove_Campaign_for_Real_Beauty" },
        { title: "Wikipedia: Evolution (advertisement)", uri: "https://en.wikipedia.org/wiki/Evolution_(advertisement)" },
        { title: "The Brand Hopper: Dove Real Beauty campaign", uri: "https://thebrandhopper.com/campaigns/dove-real-beauty-brand-campaign/" },
        {
          title: "UBC Open Case Studies: Body-positive promotion or genderwashing?",
          uri: "https://cases.open.ubc.ca/doves-real-beauty-campaign-body-positive-promotion-or-genderwashing/",
        },
        { title: "SlideShare: Dove Campaign for Real Beauty (case-study deck)", uri: "https://www.slideshare.net/slideshow/dove-campaign-for-real-beauty-16193853/16193853" },
      ],
      citations: {
        results: [[0], [0], [1], [2], [4], [2]],
        evidence: [[0], [0], [1], [0]],
      },
    },
  },
  {
    id: "aesop-queer-library-2023",
    label: "Aesop · Queer Library",
    year: 2023,
    analysis: {
      matchedCampaign: { brand: "Aesop", name: "Aesop Queer Library", year: 2023 },
      confidence: "Medium",
      confidenceReason:
        "Four independent publications cover the 2023 edition in detail, but none reports an outcome for it: no giveaway total, visitor numbers or sales effect.",
      context:
        "The Queer Library is a recurring Aesop initiative; the 2022 edition gave away over 34,000 books. The 2023 edition ran as book censorship in the US was rising: the American Library Association counted a 38% increase in titles targeted for censorship in 2022, most of them by or about LGBTQ+ people and people of colour.",
      objective:
        "Give away queer literature for free during Pride season and support the fight against book bans.",
      whatTheyDid: {
        idea:
          "Aesop turned selected stores into temporary libraries stocked with books by LGBTQIA+ authors. Visitors could choose a complimentary book and take it home, with no purchase required, while supplies lasted, and the Aesop Foundation donated $100,000 to the American Civil Liberties Union Foundation to support its work against book bans.",
        channels: [
          "Melbourne pop-up library (1–8 February)",
          "Sydney pop-up library (22 February – 1 March)",
          "New York, Los Angeles and Toronto stores (20–25 June)",
          "London Soho store (29 June – 2 July)",
          "Books from independent queer bookshops and publishers: Gay's The Word, Pilot Press, Fourteen Poems, Cipher Press, Glad Day Books, BookWoman and Penguin",
        ],
        audience: "LGBTQIA+ readers and allies in the six cities where it ran.",
      },
      results: { available: false, items: [] },
      reception: {
        praise: ["Covered favourably by design and culture press, including Wallpaper, Time Out, Hypebeast and Astrophe."],
        criticism: [],
        backlash: "",
      },
      verdict: {
        rating: "Success",
        evidence: [
          "The Aesop Foundation donated $100,000 to the ACLU Foundation alongside the 2023 edition.",
          "The 2023 edition ran in six cities on three continents: Melbourne, Sydney, New York, Los Angeles, Toronto and London.",
          "Books were free, with no purchase required.",
        ],
        interpretation:
          "Judged on what is documented, execution and reception, the 2023 edition did what it set out to do: it ran widely, put a concrete donation behind its message, and drew favourable coverage. But no outcome for 2023 has been published, so this verdict says nothing about its business impact. No confirmed outcome exists for this edition.",
        split: [],
      },
      lessons: [
        "Giving store space over to something free and useful, rather than to selling, can say more about a brand's values than an ad.",
        "Pairing a free experience with a specific donation makes a values campaign harder to dismiss as performative.",
        "Plan measurement before launch: without a published number, even a well-covered campaign can't show it worked.",
      ],
      sources: [
        { title: "Wallpaper: Aesop Queer Library, Pride Month 2023", uri: "https://www.wallpaper.com/fashion-beauty/aesop-queer-library-pride-month-2023" },
        { title: "Time Out New York: Aesop's free Queer Library returns (June 2023)", uri: "https://www.timeout.com/newyork/news/aesops-free-queer-library-returns-to-new-york-061623" },
        {
          title: "Hypebeast: Aesop Queer Library, Pride Month 2023",
          uri: "https://hypebeast.com/2023/6/aesop-queer-library-pride-month-2023-june-july-london-stores-new-york-books-lgbtqia",
        },
        { title: "Astrophe Magazine: The Aesop Queer Library", uri: "https://www.astrophemagazine.com/astrophe-magazine/the-aesop-queer-library" },
      ],
      citations: {
        results: [],
        evidence: [[0, 1], [0, 3], [2]],
      },
    },
  },
];
