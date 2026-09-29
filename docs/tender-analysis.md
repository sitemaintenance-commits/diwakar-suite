# Tender analysis

## Enable the feature

1. Apply migrations, including `20260929000006_tender_analysis.sql`.
2. Deploy the `tender-ai` Supabase function, then deploy the frontend.
3. Keep `GEMINI_API_KEY` and `TAVILY_API_KEY` configured. `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS` select models; no browser API keys are needed. The function uses Supabase's standard service-role environment variable only to persist job results.
4. Fill in **System Settings → Company profile for tender eligibility**.

## Usage

**Find with AI** searches for the full official RfS/RFP. Only matching documents selected from search results on supported authority domains are downloaded. Gemini checks the document's identity and completeness before accepting it. Notices, unrelated PDFs and supplementary documents are rejected. The UI exposes failed checks; captcha/login portals require manual download. Search cannot guarantee finding a PDF that is not indexed.

**Analyse tender PDF** on the list and detail pages accepts 1–8 PDFs, up to 50 MB combined. Include the main tender and supporting GCC/SCC/BOQ/corrigenda. Gemini's PDF limit is 1,000 pages total; oversized page counts are rejected by the provider. Excel BOQs must be exported to PDF for this flow.

Files go to private Supabase storage, then Gemini's Files API. Gemini files are deleted after analysis; Supabase sources and saved jobs remain available for retries and source attachment. Sources are private to their uploader until explicitly attached to a tender. Saved jobs are visible only to their creator with current tender permissions. Company settings follow the application's existing settings visibility rules.

Results cover document/OCR coverage, synopsis, risk clauses, company go/no-go and contradictions, with requested file/page/clause evidence. Missing company profile forces REVIEW REQUIRED. AI citations and findings still need verification against the originals.

## Background execution and limits

The server returns a job ID and continues with `EdgeRuntime.waitUntil`. Closing the dialog or browser does not cancel work. Reopen the dialog to see saved analyses. Existing tender analyses are also saved to the tender using the caller's permissions. Source attachment is a separate button.

The analysis has a 135-second budget, including Files API processing. The synopsis and the risk, go/no-go and contradiction steps run as two parallel Gemini calls over the same uploaded files, so each answer is half as long. This is a bounded background job, not an unlimited durable queue. If the platform terminates the worker, the UI identifies a job older than three minutes as timed out and offers retry. There is no automatic retry or scheduled recovery. Split very large/slow packages if needed, noting that separate runs cannot check cross-package contradictions. On local Supabase, use the documented per-worker runtime policy to allow background execution.

## Verification

Run `npm run build` and `npm run test:db`. The database suite checks job ownership, forbidden client result writes, private file paths and inactive-user restrictions. A deployed end-to-end test still requires Gemini/Tavily credentials and a real known tender PDF. Verify a scanned PDF, a multi-document contradiction, an absent company profile, navigation during processing, a failed/retried job, and a portal that requires captcha before accepting the feature for production use.

References: [Gemini PDF processing](https://ai.google.dev/gemini-api/docs/document-processing), [Supabase background tasks](https://supabase.com/docs/guides/functions/background-tasks).
