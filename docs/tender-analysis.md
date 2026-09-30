# Tender analysis

## Enable the feature

1. Apply migrations, including `20260929000006_tender_analysis.sql` and `20260929000007_tender_analysis_steps.sql`.
2. Deploy the `tender-ai` Supabase function, then deploy the frontend.
3. Keep `GEMINI_API_KEY` and `TAVILY_API_KEY` configured. Models: `GEMINI_MODEL` (analysis, default `gemini-flash-latest`) and `GEMINI_LOOKUP_MODEL` (Find with AI, default `gemini-flash-lite-latest`); the lookup only reads a screenshot, search snippets and 20 pages, so the cheaper model is enough there. Tavily: every lookup runs 2 searches (2 credits); only when the tender is found without its RfS PDF does it open up to `TAVILY_EXTRACT_PAGES` (default 5, 1 credit per 5 pages) official pages to collect their document links and run up to `TAVILY_EXTRA_SEARCHES` (default 2) more searches, one for the document on official sites and one on the authority's own site. Links are ranked to prefer the main RfS/RFP over corrigenda, pre-bid replies and BOQs. `GEMINI_MODEL` and `GEMINI_FALLBACK_MODELS` select models; no browser API keys are needed. The function uses Supabase's standard service-role environment variable only to persist job results.
4. Fill in **System Settings → Company profile for tender eligibility**.

## Usage

**Find with AI** searches for the full official RfS/RFP. Only matching documents selected from search results on supported authority domains are downloaded. Gemini checks the document's identity and completeness before accepting it. Notices, unrelated PDFs and supplementary documents are rejected. The UI exposes failed checks; captcha/login portals require manual download. Search cannot guarantee finding a PDF that is not indexed.

**Analyse tender PDF** on the list and detail pages accepts 1–8 PDFs, up to 50 MB combined. Include the main tender and supporting GCC/SCC/BOQ/corrigenda. Gemini's PDF limit is 1,000 pages total; oversized page counts are rejected by the provider. Excel BOQs must be exported to PDF for this flow.

Files go to private Supabase storage, then Gemini's Files API. Gemini files are deleted after analysis; Supabase sources and saved jobs remain available for retries and source attachment. Sources are private to their uploader until explicitly attached to a tender. Saved jobs are visible only to their creator with current tender permissions. Company settings follow the application's existing settings visibility rules.

Results cover document/OCR coverage, synopsis, risk clauses, company go/no-go and contradictions, with requested file/page/clause evidence. Missing company profile forces REVIEW REQUIRED. AI citations and findings still need verification against the originals.

**Summarise** appears at the top of every finished analysis (Analyse tender PDF, Find with AI and the tender page). It condenses the analysis, not the PDF, into a one-page brief (headline, key numbers, key points, top risks, decision, next steps) with the lookup model, so it is quick and cheap, and adds no facts the analysis does not hold. **Copy** gives it as plain text for WhatsApp or e-mail. On a tender the brief is kept in `ai_summary.brief` and shown next time; **Redo** writes it again.

**Download PDF**, next to Summarise, saves the whole analysis as an A4 report: tender details, the summary if one was written, overview, and all five sections with tables for risks (coloured by severity), go/no-go checks and contradictions, with page numbers and a verification note on every page. It is built in the browser with pdfmake, loaded only on click (its bundled Roboto font has the ₹ sign), so it costs no AI usage and works under the site's Content-Security-Policy.

## Background execution and limits

A job runs as a chain of Supabase function calls, each with its own ~135-second budget, because a 100–300 page RfS cannot be uploaded to Gemini and analysed inside one call (Supabase stops a function at 150 s):

1. `analyse` saves the job and returns its ID. In the background it uploads the PDFs to Gemini's Files API and waits until Google has processed every page.
2. It then starts three `analyse_part` calls at once — synopsis (steps 1–2), risk clauses (step 3), and go/no-go with contradictions (steps 4–5) — each in its own function run over the same uploaded files.
3. Each part is saved with `tender_analysis_save_part`, which merges it into the job in one statement so parts finishing together cannot overwrite each other. The part that completes the set combines them, saves the tender summary and deletes the Gemini copies.

Every step runs with the user's own token, so permissions apply throughout. Closing the dialog or browser does not stop the job; reopen the dialog to see progress ("2 of 3 steps done") and saved results. A job that records no progress for five minutes is shown as stopped and can be retried. There is no automatic retry. If one PDF upload alone takes longer than a function run, upload the main RfS on its own. On local Supabase, use the documented per-worker runtime policy to allow background execution.

**Find with AI** checks a downloaded PDF from its first 20 pages (so a 300-page RfS is identified in seconds) and stores it, then stops: the dialog offers **Download PDF** and **Run full analysis**. The analysis starts only when asked, as the same background job as Analyse tender PDF, and the dialog shows its progress. **Upload the PDF myself** adds a PDF the same way (up to 50 MB). Creating the tender while an analysis runs links the job to the tender (`link_analysis`), and the summary is saved on the tender when the job completes.

"Summarise PDF" on the tender page still runs in a single call, so it suits one PDF of moderate size; use **Analyse tender PDF** for full packages.

## Verification

Run `npm run build` and `npm run test:db`. The database suite checks job ownership, forbidden client result writes, private file paths and inactive-user restrictions. A deployed end-to-end test still requires Gemini/Tavily credentials and a real known tender PDF. Verify a scanned PDF, a multi-document contradiction, an absent company profile, navigation during processing, a failed/retried job, and a portal that requires captcha before accepting the feature for production use.

References: [Gemini PDF processing](https://ai.google.dev/gemini-api/docs/document-processing), [Supabase background tasks](https://supabase.com/docs/guides/functions/background-tasks).
