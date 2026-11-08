# ShieldCast architecture and production path

## 1. The prototype

The prototype on GitHub Pages proves the whole patient journey with no backend at all.

| Part | File | What it does |
| --- | --- | --- |
| Reference data | `js/data.js` | Variants, needs, weather rules, routines, cities and example stores. |
| Plan engine | `js/plan.js` | Encodes the plan in the link, chooses today's tube, builds the schedule, runs the tube clock, scores the restock signal and writes calendar files. |
| Forecast | `js/forecast.js` | Reads hourly UV, humidity and temperature from Open-Meteo, caches it for 30 minutes and falls back to a labelled sample. |
| Interface | `index.html`, `js/app.js`, `css/style.css` | Six views: Home, Doctor, Patient, Pharmacy, Supply and How it works. |
| Tests | `tests/plan.test.mjs` | 13 tests of the clinical and supply rules, run on every push by GitHub Actions. |

## 2. The rules

- **Variant choice.** Each need has a first-choice variant and a backup. Oily skin moves Emulgel to Gold, and dry skin moves Gold to Emulgel.
- **Weather rule.** The doctor may add a second tube with one rule:
  - Gold on humid days, when midday humidity is 75% or more.
  - Emulgel on dry days, when midday humidity is below 40%.
  - Pro+ on very high UV days, when peak UV is 8 or more.
  Melasma always stays on Pro+.
- **Schedule.**
  - Protection is needed while the hourly UV index is 3 or more (WHO).
  - The first application is 15 minutes before the first outdoor window that falls inside those hours.
  - Reapplication follows every 2 hours for melasma and sun-sensitising medicines, and every 3 hours otherwise, but only across outdoor windows.
  - Melasma gets a midday top-up because visible light passes through windows.
- **Tube clock.** Each application is two finger-lengths, about 1.25 g for face and neck. Daily use is the average over the 7-day forecast, so a commuter on a high-UV week sees her tube run down faster.
- **Restock signal.** UV load is the sum, over the next 7 days, of each day's peak UV above 5.
  - A load of 30 or more is high, and partner pharmacies are topped up by about 20%.
  - A load from 15 to 29 is medium, and stock rises by about 10%.
  - Four or more humid days shift the extra stock towards gels.
  - These cut-offs are hypotheses for the pilot to calibrate against stockist sell-out.

## 3. Production path

| Need | Prototype | Pilot and scale-up |
| --- | --- | --- |
| Trusting the card | 6-character check code | The plan is signed with Sun's private key (JWS, Ed25519), and the pharmacy view verifies it offline with the public key. |
| Forecast | Open-Meteo, free tier | Open-Meteo commercial licence or IMD data, with a server-side cache per city. |
| Reminders | Calendar file | WhatsApp Business utility messages from Sun's verified number, at about ₹0.12 each. A consent registry records opt-in and STOP. |
| Stock | Example stores | Partner pharmacy stock from the stockist feed, or a one-tap stock update in the pharmacy view. |
| Insight | None | Anonymised events (card scanned, tube dispensed, consent given, refill bought) flow to a warehouse that feeds the doctor's monthly report and the Rep Copilot brief. |
| Identity | None | Optional link to the ABHA health ID when the patient chooses, as ABDM pharmacy workflows mature. |

## 4. Privacy and compliance

- **Data minimisation.** The link holds a first name, an age, the need, a city and a routine. It never holds a phone number, surname or diagnosis code.
- **Consent.** Each purpose (reminders, week-one check-in, sharing adherence with the clinic) has its own opt-in, in line with the DPDP Act 2023 and Rules 2025. STOP withdraws it.
- **No substitution.** The pharmacy view offers only the backup the doctor wrote.
- **UCPMP 2024.** Cards and desk guides are informational and cost far less than ₹1,000 each.
- **Claims.** Evidence passports quote only in vivo SPF results under BIS IS 17494.

## 5. Running costs per patient

| Item | Cost |
| --- | --- |
| Rx card | About ₹2 |
| WhatsApp reminders, about 52 a year | About ₹6 a year |
| Hosting and forecast cache | Under ₹1 a year at scale |

The full programme economics (₹5.05 crore of capex, a ₹1.39 crore gated pilot and a base-case NPV of ₹20.5 crore) are in the team's financial model.
