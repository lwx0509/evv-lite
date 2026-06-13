# Path to Texas TMHP EVV Aggregator Integration

This document outlines what's involved in moving EVV-lite from private-pay-only to a
credentialed "EVV Proprietary System Vendor" that submits visit data to Texas's EVV
aggregator (TMHP, operated by Accenture on behalf of HHSC). This is a **post-traction**
step — pursue it once you have paying private-pay customers and a clear signal that
agencies want Medicaid-funded visit support too.

## 1. What changes for a Medicaid-funded visit

Today, EVV-lite stores visit + verification data locally and exports payroll CSVs.
For Medicaid-funded visits, Texas requires that visit data also be transmitted to the
TMHP EVV Aggregator, which validates it against claims before Medicaid will pay.

Two integration paths exist:

- **Use the state-provided system (HHAeXchange)**: agencies enter visit data directly
  into HHAeXchange — no integration work for you, but agencies lose the EVV-lite UI
  for Medicaid clients.
- **Become an EVV Proprietary System Vendor**: EVV-lite itself becomes the system of
  record, and submits visit data to the aggregator via API. This preserves the EVV-lite
  experience but requires certification.

The second path is the one that makes EVV-lite a real Medicaid-capable product.

## 2. Proprietary System Vendor requirements (high level)

Based on TMHP's published EVV vendor requirements, becoming a certified Proprietary
System Vendor involves:

- **Register as a vendor** with TMHP/HHSC and agree to the EVV Proprietary System
  vendor requirements.
- **Implement the required data elements** for each visit: member (client) ID,
  Medicaid program, service type, employee (caregiver) ID, visit date/time (actual
  clock-in/out), location (GPS or alternative device), service code, and reason codes
  for any manual edits.
- **Implement the TMHP EVV Aggregator API/file interface** — visit data is submitted
  via the aggregator's defined transaction format (HHAeXchange-compatible EVV
  Visit Transaction format, historically based on a defined XML/JSON or X12-like
  structure — exact spec must be pulled from current TMHP vendor documentation since
  formats are periodically updated).
- **Pass certification testing**: TMHP runs vendors through test scenarios to confirm
  visits are submitted correctly, exceptions/edits are handled, and data matches
  claims.
- **Ongoing compliance**: visits must be submitted within required timeframes (Texas
  generally requires near-real-time or daily submission), and any manual visit edits
  must include required reason codes and maintain an audit trail.

## 3. What EVV-lite already has vs. what's needed

| Requirement | EVV-lite status |
|---|---|
| GPS check-in/check-out | ✅ Have it |
| Exception flagging (late start, short visit, location mismatch) | ✅ Have it — maps well to required edit/reason codes |
| Caregiver + client identity records | ✅ Have it (extend with Medicaid member ID, caregiver Medicaid ID) |
| `payer_type` field on clients | ✅ Already anticipates this (`private_pay` vs `medicaid`) |
| Service type / program codes | ❌ Need to add fields for Medicaid program (e.g. STAR+PLUS, HCS) and service codes |
| Visit edit reason codes + audit trail | ❌ Need a structured edit-reason workflow (currently just exception flags, not edit justifications) |
| Aggregator submission integration | ❌ Need to build — file/API submission to TMHP aggregator, plus error/rejection handling |
| Certification testing | ❌ Requires working with TMHP's test environment |

## 4. Suggested sequencing

1. **Validate demand**: confirm 1+ pilot agencies actually need Medicaid EVV, not just
   private-pay. This is the main go/no-go gate identified earlier.
2. **Data model extensions**: add `medicaid_member_id`, `medicaid_program`,
   `service_code` to `clients`/`visits`; add a structured `visit_edits` table for
   reason-coded manual changes.
3. **Pull current TMHP vendor docs**: TMHP publishes EVV vendor onboarding guides and
   the current aggregator transaction spec — get the latest version directly from TMHP
   (specs and contacts change; don't rely on older cached info).
4. **Vendor registration**: register with TMHP as a Proprietary System Vendor and get
   access to their test/sandbox environment.
5. **Build the aggregator submission module**: a background job that batches completed
   visits with `payer_type = 'medicaid'` and submits them in the required format,
   handling acknowledgments/rejections.
6. **Certification testing** with TMHP using their defined test cases.
7. **Pilot with one Medicaid-funded agency** before broad rollout.

## 5. Timeline expectation

This is a multi-month effort once started (vendor registration, spec implementation,
and certification testing each take real calendar time, much of it waiting on TMHP's
process rather than engineering). Treat it as a separate project phase, not an
incremental feature — and don't start it until private-pay traction justifies the
investment.
