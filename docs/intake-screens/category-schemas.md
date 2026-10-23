# Category schemas — transcription

Owner's category screens, transcribed verbatim. Implemented in
`src/lib/intake-v3/category-schemas.ts`. Part B appends the remaining six
categories.

SCHEMAS (Yes/No = yesno; "a / b" = single unless "multi"):

## WEBINARS

WEBINARS. Core: Session length text "60 minutes"; Where will it run? text "Zoom, WebinarJam, EverWebinar..."; Will you have guest speakers or a co-host? yesno hint "If yes: have they been confirmed? Will they promote to their list?"; Is there a replay? yesno hint "Needed because Limited-Time Replay and Replay Scarcity both attach here as maximizers."; Replay expires date tag IF REPLAY gate replay=yes; Paid VIP upgrade? binds vip.offered hint "VIP yes → price, capacity, what's included. Adds a second revenue line.". Group "Someone else's webinar" gate audience borrowed: Have you already secured the spot? Booked/Still pitching binds partner.bookingStatus; Who's hosting? binds partner.host "Partner, host or affiliate"; Revenue split text "e.g. 50 / 50"; What does your agreement allow? Sell/Collect leads/Mention only; Whose list is being emailed? Theirs/Yours/Both. Group "Your own webinar" gate audience own: Cart opens/closes binds cart; Offer tested and converting? yesno tag EVERGREEN gate kind ongoing; How often does it run? Always-on/Set times tag EVERGREEN gate kind ongoing. Note "Revenue lands between cart open and cart close, not on the event date."

## FUNNELS, LAUNCHES & PROMOTIONS

FUNNELS, LAUNCHES & PROMOTIONS. Core: What are you promoting? Single product/Bundle/Store-wide/Membership/New cohort; What is the purpose of this funnel? Promote a larger initiative/Grow your list with a free gift/Sell something; Is your funnel or checkout already built? yesno hint "Yes → is it ready to process payments?"; Do you have a product catalogue? yesno; Is there a live event in the middle of this? Webinar/Challenge/Workshop/None hint "This is what makes a launch a launch rather than a campaign — and it's where the cart opens from."; cart binds cart; Is there a discount, a bonus, or both? Discount/Bonus/Both; Upsell, downsell or order bump? multi Upsell/Downsell/Order bump; Offer tested and converting? yesno; Offering calls, or straight to the offer? Book a call/Straight to offer tag VSL gate records VSL / Sales Page. Group "When partners are involved" gate block affiliate: How many partners are you recruiting? binds affiliate.partnerCount; Commission rate binds affiliate.terms; Affiliate portal? yesno; Who manages partners? text "Affiliate manager". Note "The Affiliate block, not the Partner block — many partners, no single host."

## YOUR OWN EVENT — IN-PERSON

YOUR OWN EVENT — IN-PERSON. Core: What kind of event is this? One-day intensive/Multi-day/Hybrid/In-store/Grand opening/Dinner; Have you secured a venue? Confirmed/Shortlist/Not yet; Room capacity target number "e.g. 150"; Free to attend or ticketed? Free/Ticketed hint "Ticketed → what tiers? (GA, VIP, virtual) Early-bird or price ladder?"; Guest speakers? Yes, confirmed/Yes, inviting/No; Selling sponsorships? yesno; Shipping anything to attendees or the venue? yesno hint "Drives the Physical Box Shipping Deadline maximizer — a real cutoff makes an honest deadline."; Are you traveling to this? yesno hint "If yes: will you have team on site?". Group "Type extras": What is the purpose of this dinner? Networking/Fill an affiliate promo/Sell a high-end offer tag DINNERS gate records Dinners; What are you selling? Sponsorships/Exhibitor booths/Both tag SPONSORSHIP SALES gate records Sponsorship & Exhibitor Sales; Tiers and what's in each text "Gold / Silver / Bronze..." same gate.

## YOUR OWN EVENT — VIRTUAL

YOUR OWN EVENT — VIRTUAL. Core: What's the ask? binds conversionPath; Where will it run? text "Zoom, Skool, YouTube Live..."; Guests or co-hosts? Yes, confirmed/Yes, inviting/No. Group "Dated events" gate records Challenge / Bootcamp, Your Own Virtual Summit, Hybrid Events: How many days? number "5"; Session length text "60 min"; Free or paid entry? Free/Paid; Paid VIP upgrade? binds vip.offered hint "VIP is sold during registration and pitched again on day 1 — same window as entry, different curve."; Pitch day text "Day 5 — when the offer opens"; Registration closes text "Day 2 of the challenge"; cart binds cart; How many speakers? number tag SUMMIT gate records Your Own Virtual Summit; Speakers promote to their lists? yesno tag SUMMIT same gate. Group "Shows that keep running" gate records Podcast / Vodcast, Your Own YouTube Channel, Social Media Lives: What is the purpose of this show? Promote a larger initiative/Sell something/Audience growth; How often does it go out? Weekly/Fortnightly/Monthly; Format Audio only/Audio + video.

## OTHER PEOPLE'S STAGES — IN-PERSON

OTHER PEOPLE'S STAGES — IN-PERSON. Core: What's the ask? binds conversionPath hint "If offering: new or existing product? If collecting leads: virtually or in print?"; Have you crafted your talk? Yes/Not yet; Do you have a deck? Yes/No/Don't need one; Will you have a booth or table? yesno hint "If yes: what assets are you printing? Will you be booking appointments on site?"; Are you traveling to this? yesno hint "If yes: will you have team on site?". Group "Because it is their room": Have you already secured the stage? binds partner.bookingStatus (Booked/Still pitching) hint "If not: do you have a list of the stages you want to target?"; Who's hosting? binds partner.host; In person or presenting remotely? binds format; Elevator pitch ready? yesno tag ROOMS YOU JOIN; Business card Virtual/Printed tag ROOMS YOU JOIN — gate records = the networking/chamber/mastermind-type records in this category (pick from real names, report your choice). Note "Networking, chamber and mastermind membership set is it booked? off — you register, you don't get booked."

## OTHER PEOPLE'S STAGES — VIRTUAL

OTHER PEOPLE'S STAGES — VIRTUAL. Core: Have you already secured the spot? binds partner.bookingStatus hint "If not: do you have a list of shows, hosts or summits you want to target?"; Who's hosting? binds partner.host; What does your agreement allow? Sell/Collect leads/Mention only hint "What you can take from this is set by the agreement, not by the format."; Revenue split text "e.g. 50 / 50" tag IF SELLING gate agreement=Sell; Whose list is being emailed? Theirs/Yours/Both; Will you have a call to action? yesno hint "If yes: to a link, a code, a lead magnet or a booking page?". Group "Guesting on a show" gate records Podcast / Vodcast Guest, Guest on Someone's YouTube, Social Media Lives: Format Audio only/Audio + video; Will it be published or live only? Published/Live only. Group "Their challenge or summit": How many days? number tag CHALLENGE gate records Challenge / Bootcamp; Your session date and length text "mm / dd · 60 min"; How many speakers? number tag SUMMIT gate records Virtual Summit (as Speaker) hint "Are you expected to promote it to your list? That is often the price of the slot." (gate the group to challenge+summit records).

## Implementation notes

Record names in the transcription that are not the library's exact names
were mapped to the real `wb_initiative_library` names:

| Transcription | Library record(s) |
|---|---|
| Dinners | Dinners/Lunches |
| Sponsorship & Exhibitor Sales | Event Sponsorship & Exhibitor Sales |
| Challenge / Bootcamp | Challenge / Bootcamp (Free), Challenge / Bootcamp (Paid) |
| Guest on Someone's YouTube | Guest on Someone's YouTube Channel |
| ROOMS YOU JOIN (OPS In-Person) | Networking Events, Chamber & Local Business Associations, Mastermind Membership (Someone Else's Room) |

# Part B

## PAID ADS

PAID ADS. Core: What is the purpose of your ads? Registrations to an event / Promote a larger initiative / Fill an affiliate promo / Sell something directly; Total ad budget currency binds plannedBudget; Where is the traffic going? Landing page / Sales page / Booking page; Do you have creative ready? Ready / Needs making hint "If making: video, static, or both? Churn on ad creative is high, so the task list plans for weekly refresh."; Is your pixel installed and tracking? Yes / No / Not sure hint "Easy to skip and expensive to skip — without it nothing downstream is measurable.". Group "Bought placements" gate records Podcast Ads, Newsletter Ads, note "Placements bought from a person — there's a host and a booking, so the Partner block applies.": Who's placing this? You / A partner / An agency; Have you booked the placement? Booked / Negotiating binds partner.bookingStatus. Group "Platform is an input, not an assumption": Platforms multi Meta / IG Reels / IG Feed / YouTube / Google / Pinterest / LinkedIn binds adPlatforms.

## SALES & OUTREACH

SALES & OUTREACH. Core: What is the purpose of this outreach? Book calls / Fill an event / Re-engage past clients / Renew or rebill / General connection; Who is on the list? Warm contacts / Past clients / Cold hint "Roughly how many?"; List size number "e.g. 400"; Channel Phone / SMS / Email / LinkedIn / IG DM; Who is doing the outreach? You / Setters / Closers / A team hint "If a team: how many reps? What's the commission structure?"; Script or opening message ready? yesno; CRM and calendar in place? yesno; Sending domain or number warmed up? Yes / No / Not sure tag COLD EMAIL / SMS gate records (cold email/LinkedIn + direct message/SMS-type records). Group "The one path that has no cart": When does this round of calls close? binds close hint "The one case where the close date can't be derived — it has to be entered.". Group "Where did the calls come from?": source single VSL / Webinar / Evergreen promo / Email promo / Outbound / Referral required hint "This is the only category where the source has to be asked outright — the projection has nothing usable behind it otherwise."

## EMAIL, TEXT & MAIL

EMAIL, TEXT & MAIL. Core: What is the purpose of this campaign? Promote a larger initiative / Re-engage an existing list / Sell something / Offer a free gift; Do you have a list? yesno; Roughly how big? number "e.g. 12,000" gate hasList=true; How warm is it? Active buyers / Engaged / Cold / lapsed hint "Results scale with list size and warmth. One without the other projects badly."; How many touches? text "4 – 8 emails"; Over what window? text "e.g. 10 days"; Broadcast or automation? Broadcast / Automation hint "Automation schedules ahead; broadcast keeps flexibility if the copy or funnel changes mid-promo.". Group "SMS only — compliance gate" note "These are blocking, not informational. A2P verification takes real time and varies by state — Texas is the strictest. An SMS initiative dated before verification clears cannot run.": Do you have a texting service? Skipio / Twilio / Other / None yet; Has your list explicitly agreed to texts? yesno; 10DLC business number? Yes / No / Don't know; Verified with the carriers? yesno; Compliant with government standards? Yes / Not sure. Group "Direct mail only": What are you sending? Postcard / Letter / Package; Direct mail service? yesno; Do you know which neighbourhoods or segments you're targeting? text "Postcodes, past buyers, corporate contacts..." hint "Cost per piece means this only works on tight, high-value segments."

## CONTENT & MEDIA

CONTENT & MEDIA. Core: What is this publishing meant to do? Promote a larger initiative / Grow the list with a free gift / Sell something / Audience growth; How often will you publish? Daily / Weekly / Monthly; Who is making it? You / A team / Outsourced; How will people find it? multi Ads / Your email list / Cross-posting / The algorithm hint "Always-on work with nothing driving it is the most common way a channel stalls.". Group "Type extras": Which platforms are you on? multi Instagram / LinkedIn / Facebook / TikTok / X / YouTube Shorts tag ORGANIC SOCIAL hint "And which do you want to start? Starting a platform is a different amount of work from maintaining one."; Which of these do you have? multi Blog / Website / YouTube / Google Business Profile / Directory listings / Public reviews tag SEO & AI SEARCH; Target keywords text "Top keywords & phrases" tag SEO & AI SEARCH; List size number "e.g. 12,000" tag NEWSLETTER; Hook or news angle text "Announcement, data, milestone..." tag LOCAL PR; Press kit ready? yesno tag LOCAL PR hint "Press kit means bio, headshots, boilerplate and past coverage. Local outlets want all four before they will run anything." (each tag = records gate on the matching initiative).

## PARTNERSHIPS & REFERRALS

PARTNERSHIPS & REFERRALS. Core: Commission or fee you're willing to pay text "e.g. 40% / $500 flat" binds affiliate.terms; How are they compensated? Commission / Flat fee / Product / Hybrid; Is your product tested and converting? yesno hint "If yes: do you have stats you can share with partners? They will ask, and nobody promotes an untested offer."; What can partners promote? A specific offer / An event / A lead magnet / Anything; Affiliate portal? yesno; Someone to manage partners? yesno; Do you have a list of target partners, or do you need to find them? Have a list / Need to find them. Group "The 9-month question": Are you willing to plan 9 months in advance? yesno hint "Partners need advance notice. This is the rare intake question that should change the recommended date, not just record an answer — an affiliate launch dated eight weeks out is already in trouble.". Group "Sponsorship & influencer extensions": What asset are you selling sponsorship on? Event / Podcast / Newsletter / Community tag SPONSORSHIP hint "Do you have audience numbers and a media kit? What tiers, and what's in each?"; Will you provide creative? You provide / They make it tag INFLUENCER; Approval rights before posting? yesno tag INFLUENCER; Tracking with unique links or codes? Links / Codes / Both tag INFLUENCER.

## LOCAL PRESENCE

LOCAL PRESENCE. Core: Which of these do you already have? multi Google Business Profile / Yelp / Directory listings / Public reviews / None of these; Is your business information consistent everywhere? Yes / No / Not sure hint "Name, address, phone, hours. Inconsistency is the single most common reason local ranking stalls."; Do you have photos of your business, team and work? Yes / Some / No; Roughly how many reviews now? number "e.g. 24"; Do you respond to reviews? Always / Sometimes / No; Do you have a process for asking customers for reviews? yesno; Do you serve customers at a location, or travel to them? At a location / We travel / Both hint "Changes what can be claimed and how the service area is set."

## Part B implementation notes

Special rules applied:

- Paid Ads is ads, so the universal form's Ads reveal (ad platforms + ad
  budget) is always on for category `paid-ads`, and `plannedBudget` is written
  even when "Ads" is not ticked under "What's promoting it?"
  (`ADS_CATEGORY_ID` / `marketingReveals` in `universal-form.ts`).
- Email/SMS: the SMS group gates on the SMS records, the direct-mail group on
  Direct Mail.
- "How warm is it?" reads "Cold / lapsed" as ONE option (three options in
  all), not "Cold" and "lapsed" separately.

| Transcription | Library record(s) |
|---|---|
| Your Own SMS Community | Your Own SMS / Text Community |
| SMS / Text Campaign | SMS / Text Campaign |
| COLD EMAIL / SMS (Sales & Outreach) | Cold Email / LinkedIn Outbound, Direct Message Reach Out (no SMS record exists in this category) |
| ORGANIC SOCIAL | Organic Social |
| SEO & AI SEARCH | SEO & AI Search |
| NEWSLETTER | Your Own Newsletter |
| LOCAL PR | Local PR & Community Media |
| SPONSORSHIP | Sponsorship Sales on Your Own Assets |
| INFLUENCER | Influencer Marketing |
