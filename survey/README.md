# ShieldCast survey material

This folder keeps measured and modelled numbers apart.

- `model.py` builds the **modelled panel**. It is a simulation, not fieldwork. Each answer share is set from a published study (`anchored`) or a stated team assumption (`assumed`), then sampled with a fixed seed. Run `python3 model.py` to rebuild it.
- `survey_model.json` holds the tallies shown on `research.html` and in the deck.
- `modelled_patients.csv`, `modelled_pharmacists.csv` and `modelled_dermatologists.csv` hold every simulated answer.
- `live.json`, when present, holds totals from the real patient survey. The survey is anonymous and collects no name, phone number or email.
