"""ShieldCast modelled survey panel.
This is NOT fieldwork. It simulates respondents whose answer shares are set from published studies
(marked 'anchored') or from stated team assumptions (marked 'assumed'). Seeded, so anyone can rerun it."""
import json, csv, random
random.seed(20261111)

def draw(opts):
    r = random.random(); c = 0
    for k, p in opts:
        c += p
        if r < c: return k
    return opts[-1][0]

A, H = "anchored", "assumed"
PAT = [  # id, question, [(option, share)], basis, note; shares for the whole base unless 'base' says otherwise
 ("freq", "How often do you use sunscreen?", None, A, "Statista and ProdegeMR 2019: 33% daily; Mintel 2019: 65% non-users nationally; metro adults aged 18 to 45 set higher on use"),
 ("times", "On a day you use it, how many times do you apply it?", [("Once", .68), ("Twice", .24), ("Three or more times", .08)], H, "Dermatologists say 99.4% of patients under-apply (Farberg 2017); no Indian reapplication rate published"),
 ("know", "Do you know when you should reapply?", [("Yes, clearly", .18), ("Roughly", .37), ("No", .45)], A, "Upadhyay 2021: 70% of medical students did not know the ideal SPF; Mintel 2019: 25% do not understand SPF or PA"),
 ("source", "Who or what led you to your sunscreen?", [("A dermatologist or doctor", .29), ("A pharmacist", .06), ("Social media or an influencer", .33), ("Friends or family", .20), ("An advertisement or online store", .12)], H, "Digital-first brands hold about 47% of sun care value (Euromonitor 2025)"),
 ("rx", "Has a doctor ever named a specific sunscreen for you?", [("Yes", .34), ("No", .66)], H, "Team assumption for metro adults"),
 ("bought", "If yes, what did you buy?", [("Exactly that one", .60), ("A different one", .26), ("None", .14)], H, "Matches the 60% baseline conversion in our financial model"),
 ("why", "If not the exact one, the main reason", [("Not available at the pharmacy", .31), ("Too expensive", .27), ("Pharmacist suggested another", .20), ("Preferred a brand I knew", .12), ("Ordered what was online", .10)], A, "Iyer and Berad: 34.8% of dermatology brands substituted; Vector 2025: prescribed brand unavailable in 10 to 60% of cases"),
 ("barrier", "What mainly stops you using sunscreen regularly?", [("I forget", .24), ("It feels sticky or oily", .25), ("The price", .16), ("I am not sure I need it", .12), ("It leaves a white cast", .09), ("It makes my skin break out", .06), ("Nothing stops me", .08)], A, "Agarwal 2018: sticky 25% and expensive 18% among aware non-users; 'less sticky' wanted by 73%"),
 ("lasts", "How long does a 50 g tube last you?", [("Less than 1 month", .14), ("1 to 2 months", .38), ("3 months or more", .33), ("Not sure", .15)], H, "At the tested dose a 50 g tube lasts about 3 weeks, so longer means under-dosing"),
 ("qr", "Would you scan a QR code on your prescription for a daily plan?", [("Yes", .52), ("Maybe", .31), ("No", .17)], H, "Team assumption; QR payments are an everyday habit in Indian cities"),
 ("wa", "Would you accept WhatsApp reminders you can stop any time?", [("Yes", .41), ("Maybe", .30), ("No", .29)], H, "Team assumption; evidence on reminders is mixed (PLOS ONE 2020)"),
 ("help", "Which one would help you most?", [("Exact reapply times for today's sun", .29), ("A sunscreen matched to the season", .27), ("A reminder when my tube runs low", .18), ("Knowing which pharmacy has it", .14), ("None of these", .12)], H, "Team assumption, to be replaced by the live survey"),
]
FREQ = {"Woman": [("Every day", .38), ("A few days a week", .19), ("Only when I expect strong sun", .21), ("Rarely", .11), ("Never", .11)],
        "Man":   [("Every day", .21), ("A few days a week", .15), ("Only when I expect strong sun", .23), ("Rarely", .18), ("Never", .23)]}

EXACT_BUYER = [("Every day", .48), ("A few days a week", .22), ("Only when I expect strong sun", .18), ("Rarely", .08), ("Never", .04)]

def patients(n=300):
    spec = {qid: opts for qid, _, opts, _, _ in PAT}
    rows = []
    for i in range(n):
        g = "Woman" if random.random() < .52 else "Man"
        r = {"id": f"P{i+1:03d}", "gender": g}
        r["rx"] = draw(spec["rx"])
        r["bought"] = draw(spec["bought"]) if r["rx"] == "Yes" else ""
        r["why"] = draw(spec["why"]) if r["bought"] in ("A different one", "None") else ""
        # people who bought the exact prescribed tube are more regular users than the rest
        r["freq"] = draw(EXACT_BUYER if r["bought"] == "Exactly that one" else FREQ[g])
        user = r["freq"] != "Never"
        for qid in ("times", "know", "source", "barrier", "lasts", "qr", "wa", "help"):
            r[qid] = "" if (qid in ("times", "source", "lasts") and not user) else draw(spec[qid])
        rows.append(r)
    return rows

PHA = [
 ("oos", "How often is the exact prescribed sunscreen out of stock?", [("Often", .22), ("Sometimes", .48), ("Rarely", .25), ("Never", .05)], A, "Vector Consulting 2025 (900+ chemists, 18 cities): prescribed brand unavailable in 10 to 60% of cases"),
 ("then", "When it is out of stock, what do you usually do?", [("Offer another brand", .42), ("Order it for later", .25), ("Offer another variant of the same brand", .18), ("Send the customer elsewhere", .15)], A, "Iyer and Berad: 34.8% of dermatology brand requests were substituted"),
 ("range", "How many of the four Photostable variants do you keep?", [("All four", .28), ("Two or three", .47), ("One", .18), ("None", .07)], A, "Vector 2025: chemists carry 60 to 85% of a company's brands"),
 ("season", "Does sunscreen demand change with the season?", [("Yes, a lot", .70), ("A little", .22), ("No", .08)], H, "Team assumption; Euromonitor notes strong summer seasonality"),
 ("ask", "Do customers ask how much to use or when to reapply?", [("Often", .15), ("Sometimes", .40), ("Rarely", .45)], H, "Team assumption"),
 ("scan", "Would you scan a QR code on a prescription if it took under 10 seconds?", [("Yes", .38), ("Maybe", .37), ("No", .25)], H, "Team assumption, the riskiest belief in our plan"),
 ("worth", "What would make scanning worthwhile?", [("Priority restock before peak weeks", .30), ("Customers returning for refills", .27), ("A small credit per scan", .25), ("Product training", .08), ("Nothing", .10)], H, "Team assumption"),
 ("hold", "Would you hold a tube for 24 hours on a phone request?", [("Yes", .63), ("Maybe", .25), ("No", .12)], H, "Team assumption"),
]
DOC = [
 ("factor", "What decides which sunscreen you prescribe?", [("Broad-spectrum protection and SPF", .34), ("Feel on skin, so the patient uses it", .30), ("Fit with skin type and condition", .16), ("Cost to the patient", .10), ("Published evidence", .10)], A, "Farberg 2017: 71% of dermatologists weigh cosmetic elegance; PRISM-ISF 2025: feel and affordability drive adherence"),
 ("exact", "How often do you name the exact variant?", [("Always", .32), ("Usually", .38), ("Sometimes", .20), ("Rarely", .10)], H, "Team assumption"),
 ("two", "How often do you prescribe two sunscreens to one patient?", [("Often", .05), ("Sometimes", .20), ("Rarely", .45), ("Never", .30)], H, "Team assumption; the case itself reports low multi-SKU prescribing"),
 ("block", "What mainly stops a second variant?", [("No clear clinical reason", .34), ("Cost to the patient", .28), ("The variants look alike", .18), ("Patients will not buy two", .12), ("Doubt about stock", .08)], H, "Three of four Photostable labels carry the same SPF 55"),
 ("buy", "How confident are you that patients buy the exact product?", [("Very", .18), ("Somewhat", .52), ("Not confident", .30)], A, "Substitution of dermatology brands 34.8% (Iyer and Berad)"),
 ("reapply", "How confident are you that patients reapply as advised?", [("Very", .05), ("Somewhat", .30), ("Not confident", .65)], A, "Farberg 2017: 99.4% say patients under-apply"),
 ("switch", "Would you allow a texture switch by season at refill?", [("Yes", .48), ("Maybe", .34), ("No", .18)], H, "Team assumption; PRISM-ISF asks for texture matched to need"),
 ("feedback", "Would a monthly report on patients' buying and use help?", [("Yes", .62), ("Maybe", .26), ("No", .12)], H, "Team assumption"),
 ("proof", "Which proof would raise your trust most?", [("In vivo SPF data on Indian skin", .35), ("A peer-reviewed study", .25), ("Visible-light protection data", .22), ("A consensus guideline", .13), ("Samples", .05)], H, "BIS made in vivo SPF proof compulsory in 2026"),
 ("emr", "How do you write prescriptions?", [("On e-prescription software", .45), ("Both", .20), ("On paper", .35)], A, "Eka Care is IADVL's preferred clinic software (12,500+ dermatologists reached, 2023)"),
]

def simple(spec, n, prefix):
    rows = []
    for i in range(n):
        r = {"id": f"{prefix}{i+1:03d}"}
        for qid, _, opts, _, _ in spec: r[qid] = draw(opts)
        rows.append(r)
    return rows

def tally(rows, spec, opts_override=None):
    out = []
    for qid, q, opts, basis, note in spec:
        vals = [r[qid] for r in rows if r.get(qid)]
        labels = [k for k, _ in (opts or FREQ["Woman"])]
        n = len(vals)
        out.append({"id": qid, "q": q, "n": n, "basis": basis, "note": note,
                    "options": [{"label": l, "count": vals.count(l), "pct": round(100 * vals.count(l) / n, 1) if n else 0} for l in labels]})
    return out

P, C, D = patients(300), simple(PHA, 60, "C"), simple(DOC, 40, "D")
res = {"meta": {"label": "Modelled panel, not fieldwork", "seed": 20261111, "date": "2026-11-11",
                "method": "Simulated respondents. Each answer share is set from a published study (anchored) or a stated team assumption (assumed), then sampled so the panel behaves like a real sample of that size.",
                "sizes": {"patients": 300, "pharmacists": 60, "dermatologists": 40}},
       "patients": tally(P, PAT), "pharmacists": tally(C, PHA), "dermatologists": tally(D, DOC)}
# gender split on daily use
for g in ("Woman", "Man"):
    sub = [r for r in P if r["gender"] == g]
    res["meta"][f"daily_{g.lower()}"] = round(100 * sum(r["freq"] == "Every day" for r in sub) / len(sub), 1)
# the leak funnel, per 100 patients who were given a named sunscreen
rx = [r for r in P if r["rx"] == "Yes"]; n = len(rx)
exact = [r for r in rx if r["bought"] == "Exactly that one"]
daily = [r for r in exact if r["freq"] == "Every day"]
reap = [r for r in daily if r["times"] in ("Twice", "Three or more times")]
res["funnel"] = {"base_n": n, "steps": [["Given a named sunscreen", 100], ["Bought exactly that one", round(100 * len(exact) / n)], ["Use it every day", round(100 * len(daily) / n)], ["Reapply at least once", round(100 * len(reap) / n)]],
                 "counts": [n, len(exact), len(daily), len(reap)]}
json.dump(res, open("survey_model.json", "w"), indent=1)
for name, rows in (("patients", P), ("pharmacists", C), ("dermatologists", D)):
    with open(f"modelled_{name}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
for grp in ("patients", "pharmacists", "dermatologists"):
    print("==", grp)
    for q in res[grp]:
        print(f" {q['id']:9s} n={q['n']:3d} [{q['basis'][:3]}] " + "; ".join(f"{o['label'][:28]} {o['pct']}" for o in q["options"]))
print(res["funnel"], res["meta"]["daily_woman"], res["meta"]["daily_man"])
