## What this changes

<!-- One or two sentences. -->

## If this adds or changes an entry

- [ ] Every fact in the entry comes from a source cited in `sources`
- [ ] At least one source has `kind: official`
- [ ] `verification.verified_fields` lists only fields I actually checked against a source
- [ ] `verification.last_verified` is the date I checked, not the date I edited the file
- [ ] The entry lists at least one weakness
- [ ] No claim that anything is "the best" without a citation
- [ ] Fields I could not verify are omitted rather than filled in from memory

## Checks

- [ ] `aimodeldb validate` passes with no errors and no warnings
- [ ] `pytest -q` passes
- [ ] `ruff check . && ruff format --check . && mypy` pass
