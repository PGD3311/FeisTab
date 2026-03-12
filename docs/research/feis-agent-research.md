# Feis Agent Research — Deep Dive on Irish Step Dancing Competitions

**Date:** 2026-03-12
**Purpose:** Expert research on what an Irish step dancing app would look like if it answered all 15 Phase 1 truth test questions. Conducted by three parallel research agents covering operations, scoring/tabulation, and trust/accountability.

---

## Group A: Organizer Operations (Q1, Q3, Q4, Q5, Q8)

### Q1: End-to-End Without Touching the Database

**The People Involved at a Real Feis:**
- **Feis Chairperson/Organizer**: Ultimate authority. "The decision of the Feis Committee is final in all matters connected with the Feis."
- **Adjudicators (Judges)**: Certified by governing body (CLRG requires ADCRG or SDCRG). Grade levels have 1 adjudicator; championships have 3 (local) or 5-7 (majors). At CLRG majors, adjudicators are sequestered with no phones/tablets/smartwatches.
- **Tabulators**: In a restricted-access room. "During competitions, tabulators may not be approached by anyone except by the Feis Committee." May be parent volunteers or professional services (FeisFWD charges ~$700+ travel).
- **Stage Managers/Marshals**: Manage physical dancer flow, maintain "NOW"/"NEXT" signs, check in dancers by competitor number.
- **Musicians**: Live or recorded music operators.
- **Results Room Volunteers**: Physically post printed results.
- **Runners**: Carry paper score sheets from judges to tabulation room.

**The Current Manual Process:**

Before the feis:
1. Organizer creates syllabus (list of competitions with age groups and levels)
2. Registration via FeisWorx, QuickFeis, FeisFWD, iFeis, or Feis.link
3. Assign competitions to stages, create schedule (released ~1 week before)
4. Pre-print score sheets with competitor numbers

Day-of, per competition:
1. **Staging**: Marshal posts competition, dancers check in side-stage in numerical order
2. **Performing**: Dancers perform 2-3 at a time. Judge writes raw scores (0-100, typically 70-95) on paper
3. **Score Sheet Handoff**: Runner carries paper from judge to tabulation room
4. **Tabulation (Grade)**: Simple ranking by raw score
5. **Tabulation (Championship)**: Each judge's raw scores → rank → Irish Points conversion → sum across judges → handle ties → determine recall list (top 50%+1) → post recall → dance Round 3 → final tabulation
6. **Verification (Majors)**: Scores input by one tabulator, verified by another, confirmed by adjudicator
7. **Results Posting**: Printed on wall/board
8. **Awards**: Medals at awards table (grade), announced live (championship)
9. **Online Publication**: Uploaded to FeisResults.com, FeisWorx, etc.

**Current Software Landscape:**

| Platform | What It Does | Limitations |
|----------|-------------|-------------|
| **FeisWorx** | Registration, payment, tabulation (via MyFeis), results. "Premier services provider for feiseanna in North America." | Aging interface. |
| **QuickFeis** | Registration, payment, results. | Similar scope to FeisWorx. |
| **FeisFWD** | Full lifecycle: planning, syllabus, entries, adjudication, tabulation, results. Digital scoring via app. | Professional tabulation costs $700+. |
| **iFeis** | Registration, live stage schedule, participant search. | Less widely adopted. |
| **Feis.link** | Online registration + day-of tabulation. | Newer entrant. |
| **FeisMark** | Championship-only scoring software (Windows). Handles up to 5 adjudicators, 3 rounds + recall. | Championship only, Windows desktop. |
| **Instep FM** | Used for major UK/Ireland championships. | Limited to major events. |
| **FeisResults.com** | Professional tabulation service + results hosting. | Service provider, not self-service. |

**Pain Points:**
1. Paper-to-digital gap (runners, manual transcription, errors)
2. Tabulation bottleneck ("can take half hour to several hours")
3. Volunteer dependency (quality varies enormously)
4. Fragmented tools (registration on one platform, tabulation on another)
5. No real-time visibility (organizer must physically walk around)
6. Error discovery is late (found only when results posted)
7. Regional rule variation

---

### Q3: Competition States and UI Control

**Real-world states:**
1. Scheduled → 2. Checked-In/Staging → 3. In Progress/Performing → 4. Scoring Complete/Awaiting Tabulation → 5. In Tabulation → 6. Awaiting Recall (championships) → 7. Recall In Progress → 8. Tabulated/Awaiting Review → 9. Published/Results Posted → 10. Archived

**How tracked today:**
- Physical signs at each stage ("NOW"/"NEXT")
- Tabulation room awareness (locked inside the room)
- Results wall as only public completion indicator
- Feis Chairperson's mental model from walking between stages
- No dashboard exists

**Handling delays/reordering:**
- Delays common and expected. Stages held for dancers on other stages.
- Feis Committee can re-order competitions. Early finishes mean next starts early.
- Low-entry competitions may be combined or cancelled. Entries non-refundable.

**Ideal UI:** Per-stage timeline view, color-coded states, drag-and-drop reordering, one-click transitions, cross-stage conflict detection, time estimation, blocker badges.

---

### Q4: Obvious, Actionable Blockers

**What actually blocks competitions:**
1. Missing/unavailable adjudicator
2. Incomplete scores (judge missed a dancer)
3. Score sheet not received from runner
4. Tabulation errors (entered scores don't match paper)
5. Recall verification pending (adjudicator slow to confirm)
6. Dancer no-shows affecting lineup (may need to combine age groups)
7. Cross-stage scheduling conflict
8. Costume/rule violations (CLRG "Costume Infraction Tick Box Program")
9. Age/level eligibility disputes
10. Music/technical issues

**How discovered today:** Feis Chairperson walks around. Or parents complain. Or tabulators discover illegible sheets and need to find the judge.

**"Oh shit" moment:** "Results posted with incorrect placements, parents angry, competition can't be re-run." Or: "Recall posted but adjudicator realizes scores were entered wrong, dancers already told they didn't recall."

**Ideal system:** Pre-competition checklist, real-time blocker badges with specific messages, time-based alerts, conflict detection, resolution action buttons.

---

### Q5: Dancer Status Handling

**All reasons a dancer might not compete:**
1. Pre-feis scratch (illness, schedule conflict). Entries non-refundable.
2. Day-of no-show (registered but never checks in)
3. Late arrival (may not be allowed to dance — feis committee discretion)
4. Withdrawal mid-competition (injury, choice)
5. Medical withdrawal during performance
6. Failed start (WIDA: cannot score more than 1 point)
7. DQ — age/level violation ("falsification of documents = disqualification")
8. DQ — costume infraction
9. DQ — conduct
10. DQ — registration irregularity

**Effect on other dancers:**
- No-show/scratch: Not scored, no re-ranking needed
- DQ after results computed: Everyone below moves up, requires re-tabulation

**CLRG rules:** Dancers must compete in own age group. Exceptions only for higher age group. Costume infractions via tick box program.
**WIDA rules:** Entries non-refundable. Championship dancers need minimum 2 adjudicators.
**NAFC/IDTANA:** Combining male/female dancers is regional discretion. Grade progression rules vary by region.

---

### Q8: Publish as Explicit Controlled Action

**How results published today:**
1. Physical posting on "results wall" — "usually a room or hallway with posters hung"
2. Live announcements for trophy specials and championships only
3. Online posting after feis or same-day to FeisResults.com, FeisWorx, etc.

**Who has authority:** Feis Committee (specifically Chairperson). At CLRG majors, explicit adjudicator verification before recall posting.

**Flow between computed and official:**
1. Tabulation produces draft result
2. Verification (second tabulator checks math; at majors, adjudicators review)
3. Committee review for obvious anomalies
4. Physical posting (results become "public")
5. Award distribution
6. Online publication (hours/days later)

**Recall-specific flow:** Rounds 1-2 tabulated → recall list computed → each adjudicator confirms → recall posted → Round 3 danced → final results through full cycle again.

**Teacher results packages:** Detailed results (all adjudicators' raw scores and comments) provided to teachers AFTER public results posted.

---

## Group B: Scoring & Tabulation (Q2, Q6, Q9, Q10, Q13)

### Q2: Dual Entry Modes

**How judges currently score:**
Paper score sheets with competitor numbers pre-printed. One raw score (0-100) per dancer. Four criteria assessed holistically: timing, carriage, footwork/technique, elevation. Not scored as separate line items at grade level.

Judge sits at small table beside stage. Watches 2-3 dancers at a time. Writes score, optional shorthand comments. Sheet carried to tabulation room by runner. Strict isolation rules — adjudicators may not be approached.

**Digital adoption (current):**
- FeisMark: Windows-based, championship-focused, fast but desktop-only
- FeisFWD: Web-based, tick boxes for feedback categories
- Digital Feis: Video-based, 5-category rubric (Knowledge, Timing, Lower Body, Upper Body, Presentation), each /20
- Most grade-level local feiseanna still use paper

**Dual mode requirements:**

| Aspect | Judge Self-Service | Tabulator Transcription |
|--------|-------------------|------------------------|
| Who enters | Adjudicator directly | Tabulation volunteer reading paper |
| Device | Tablet/phone at stageside | Desktop/laptop in tab room |
| Speed priority | Comfort (between sets of dancers) | Throughput (batch multiple competitions) |
| Validation need | Light (judge is authority) | Heavy (transcription errors common) |
| Packet ownership | Judge owns packet | Tabulator owns, attributes to judge |

---

### Q6: Detecting Bad Score Packets

**What goes wrong:**
1. Missing scores (judge forgot a dancer)
2. Illegible handwriting (7 vs 1, 8 vs 3)
3. Wrong competitor number (judge misread number card)
4. Scores for dancer in wrong competition
5. Duplicate sheets (Round 1 resubmitted as Round 2)
6. Math errors on manual totals
7. Transposed scores during transcription (78 → 87)
8. Scores out of expected range
9. Raw scores contradict written placements

**Automated detection tiers:**

| Check | Severity |
|-------|----------|
| Missing score (registered dancer, no score from judge) | Blocker |
| Extra score (competitor not in this competition) | Blocker |
| Duplicate entry (same judge + dancer + round) | Blocker |
| Incomplete packet (not all dancers scored) | Blocker |
| Packet count mismatch (expected 3 judges, got 2) | Blocker |
| Score out of range (<40 or >100) | Warning |
| Statistical outlier (>2 SD from judge's mean) | Warning |
| Cross-judge divergence (Judge A: 1st, Judge B: last) | Warning |

---

### Q9: Safe Score Corrections

**When corrections happen:**
- Judge realizes number mixup (transposition)
- Tabulator transcription error
- Organizer catches anomaly during verification
- Post-announcement discovery (parent/teacher challenge)

**Formal complaint process:**
- CLRG-affiliated: Written complaint within 1 hour, $10 fee (grade) / $15 fee (championship). Returned if justified.
- WIDA: Written objection on day of feis, 50 EUR fee. Returned if upheld.
- All orgs: Adjudicator's artistic judgment is final. Corrections only for factual/mechanical errors.

**Safe correction design:**
1. Never overwrite — version every change (original preserved)
2. Require text reason for every correction
3. Require organizer authorization (tabulator flags, organizer approves)
4. Auto-invalidate downstream results
5. Time-window awareness (pre-publish vs post-publish corrections)

---

### Q10: Re-Tabulation After Correction

**The Irish Points System (full table):**

| Place | Points | Place | Points | Place | Points | Place | Points | Place | Points |
|-------|--------|-------|--------|-------|--------|-------|--------|-------|--------|
| 1st | 100 | 11th | 41 | 21st | 30 | 31st | 20 | 41st | 10 |
| 2nd | 75 | 12th | 39 | 22nd | 29 | 32nd | 19 | 42nd | 9 |
| 3rd | 65 | 13th | 38 | 23rd | 28 | 33rd | 18 | 43rd | 8 |
| 4th | 60 | 14th | 37 | 24th | 27 | 34th | 17 | 44th | 7 |
| 5th | 56 | 15th | 36 | 25th | 26 | 35th | 16 | 45th | 6 |
| 6th | 53 | 16th | 35 | 26th | 25 | 36th | 15 | 46th | 5 |
| 7th | 50 | 17th | 34 | 27th | 24 | 37th | 14 | 47th | 4 |
| 8th | 47 | 18th | 33 | 28th | 23 | 38th | 13 | 48th | 3 |
| 9th | 45 | 19th | 32 | 29th | 22 | 39th | 12 | 49th | 2 |
| 10th | 43 | 20th | 31 | 30th | 21 | 40th | 11 | 50th | 1 |

**Tie handling:** Average Irish Points for tied positions. Two-way tie for 2nd = avg(75, 65) = 70 each.

**Drop rule (5+ judges):** Highest and lowest marks dropped per competitor.

**Championship rounds:** Round 1 (soft shoe) → Round 2 (hard shoe) → Recall (top ~50%+1) → Round 3 (set dance) → Final combined.

**Manual tabulation time:** 15-30 minutes for a championship. In software: instant.

**Re-tabulation design:**
1. Idempotent (same inputs = same outputs, always)
2. Diff view before commit ("Dancer #124 moves from 5th to 3rd")
3. Pre-recall guard (if recall already danced and correction changes recall list: hard warning)
4. Every tabulation run logged with inputs, timestamp, actor, outputs

---

### Q13: Tabulator Entry Speed

**Feis scale:** 200-400 competitors typical, 3-5 stages simultaneous. Grade competitions: 5-20 dancers. Championships: 15-50+ dancers.

**Dance duration:** Each dancer ~30-60 seconds. 2-3 dance at a time. 12-dancer competition = ~3-6 minutes of dancing.

**Speed targets:**

| Metric | Target | Rationale |
|--------|--------|-----------|
| Keystrokes per score | 4-6 (2-3 digit score + Tab/Enter) | Number pad entry, auto-advance |
| Grade comp (12 dancers) | < 2 minutes | Faster than paper sorting |
| Championship round (25 dancers, 1 judge) | < 3 minutes | Not the bottleneck |
| Tab-to-next-field latency | < 100ms | Any perceptible lag breaks flow |
| Error correction | Single keystroke (Backspace + retype) | No modal dialogs during entry |

**UX requirements:** Spreadsheet-style grid (not form), pre-populated dancer list, number-pad optimized, visual completeness indicator, batch confirmation (not per-entry), keyboard-only operation, queue awareness sidebar.

---

## Group C: Trust, Accountability & UX (Q7, Q11, Q12, Q14, Q15)

### Q7: Results Preview Before Approval

**What goes wrong:** UK feiseanna have had public tabulation error admissions. Forum posts describe "way too many errors." Dancers receiving different scores on results packs than announced. ROI results reportedly "changed 3 times online."

**Organizer's fear:** Wrong results going public = reputational catastrophe. Cascading consequences: venue chaos, online fallout, incorrect championship qualifications, trust destruction in post-scandal era.

**Preview requirements:**
1. Side-by-side raw data view (each judge's scores → ranking → Irish Points → total)
2. Automated sanity flags (judge divergence, impossible scores, recall edge cases)
3. Recall cutoff visualization with explicit threshold
4. Diff view for any corrections
5. Explicit "Approve and Publish" — no auto-publishing
6. Draft/preview mode showing exactly what parents will see

---

### Q11: Audit Trail

**Current record-keeping:** Paper score sheets boxed up. No standardized retention requirement found in CLRG rules. Results packs provided to teachers at championship level.

**The feis-fixing scandal context (2022):** Leaked WhatsApp messages showed teachers coordinating placements with adjudicators. 44 individuals faced hearings. CLRG complaint process found "not trusted," disciplinary process "not fit for purpose." All cases dropped because 2019 allegations weren't submitted until 2022 — no contemporaneous audit trail.

**Governance requirements:**
- CLRG: Post-scandal reforms include sequestration, timed number release, 5-judge panels with drop rules, democratic adjudicator selection
- WIDA: Written objections with fee on day of feis
- NAFC/IDTANA: Feis committee's decision is final

**What happens when parents challenge later:** Teachers contact organizer informally. Organizer digs through paper boxes. No structured post-hoc review system. Marks packs vs. announced results discrepancies are irreconcilable without originals.

**Audit trail requirements:**
1. Every score entry timestamped with user identity
2. Immutable change log (modifications create new records, originals preserved)
3. Approval chain logged (entry → review → approval → publication)
4. Publication record (when, who authorized)
5. Digital archive of original paper sheets (photo/scan linked to record)
6. Retention policy (minimum 2 years, ideally matching qualification cycle)
7. Export capability (complete audit package per competition)

---

### Q12: Fail-Safe Design

**Typical feis venues:**
- **Hotel ballrooms**: WiFi for guests, not 500+ people. Thick walls, dead zones.
- **School gyms**: Captive portal auth, weak gym coverage, poor cellular in older buildings.
- **Community centers/parish halls**: Often no public WiFi, weak cellular.
- **Convention centers**: Expensive WiFi, saturated by thousands of attendees.

**Current fallback:** Paper, always paper. The system that never fails existed before computers.

**Nightmare scenario:** Partially digitized feis where software crashes mid-event. Hours of entered scores lost. Volunteers re-enter everything from paper.

**Fail-safe requirements:**
1. Offline-first architecture (all core functions work without network)
2. Local data persistence (survives crash/restart)
3. Graceful degradation tiers (full connectivity → intermittent → offline → device failure)
4. Conflict resolution for offline concurrent edits
5. Print capability from any device without network
6. Battery-efficient (8-12 hour feis days)
7. Explicit sync status indicators
8. Paper backup integration (print blank sheets at any point)

---

### Q14: Judge Entry on Tablet/Phone

**Who are the judges:** ADCRG-certified, minimum age 30, most 40s-60s. Tech savviness varies enormously. Sit at small table at stage front. Split attention between watching 2-4 dancers simultaneously, writing scores, tracking numbers. Noisy, relentless pace (200+ dancers/day).

**Realistic devices:** Provided iPads/tablets most likely. Personal phones problematic (small screens, varied devices). Shared device login/logout issues.

**Judge-friendly entry requirements:**
1. Massive touch targets (calculator-app sized, not spreadsheet)
2. Minimal interaction per dancer (see number → tap score → next)
3. Quick-tap score grid (pre-set scores: 70, 75, 78, 80, 82, 85, 88, 90, 95)
4. Auto-advancing competitor list
5. High contrast, readable at arm's length
6. Shorthand comment system (tap-to-select: TO, PT, TM, CR, EL, XO — green/red)
7. No network dependency during scoring
8. Session lock (device locked to judge+competition)
9. Undo/correction without menu navigation
10. Paper fallback always available

---

### Q15: Result Explainability

**Common challenges from parents/teachers:**
1. "My dancer scored higher but placed lower" (misunderstanding Irish Points)
2. "My dancer should have been recalled" (cutoff disputes)
3. "Scores changed between announcement and results pack"
4. "The judge was unfair" (post-scandal suspicion)
5. Grade-level placement disputes

**Formal processes:**
- CLRG: Committee's decision is final. Post-scandal complaint process found "not trusted."
- WIDA: Written objection + 50 EUR fee on day of feis
- No published formal appeal mechanism across orgs

**What organizer needs to defend a result:**
1. Original scores from each judge
2. Conversion math (raw → rank → Irish Points → total → placement)
3. Recall calculation (how many danced, cutoff, where dancer fell)
4. Evidence no scores were changed (impossible with paper alone)

**Worst case:** Organizer who can't explain = loss of credibility, teacher boycotts, regional council scrutiny, and in post-scandal era, indistinguishable from corruption.

**Explainability features:**
1. One-click result breakdown per dancer (all judges, all math, visual)
2. "Why didn't I recall?" view with specific numbers
3. Score divergence visualization across judges
4. Immutable published record (both original and corrected versions)
5. Shareable result link (send to parent as complete explanation)
6. Audit stamp on every result page

---

## Critical Cultural Context

**The 2022 feis-fixing scandal is the defining event.** Teachers and adjudicators coordinated placements via WhatsApp. 44 faced hearings. All cases dropped. CLRG found to have "overall lack of trust" and processes "not fit for purpose."

**Post-scandal reforms:** Sequestration, timed number release, 5-judge panels with drop rules, democratic adjudicator selection. All point toward more transparency, more separation of concerns, more verifiable processes.

**FeisTab positioning:** The digital equivalent of these reforms — immutable audit trails, transparent calculations, role-based access, and results any organizer can defend with data.

---

## Key Numbers

| Fact | Value |
|------|-------|
| Raw score range | 0-100 (typically 70-95 for grades) |
| Grade competition judges | 1 |
| Championship judges (local) | 3 |
| Championship judges (majors) | 5-7 |
| Irish Points: 1st | 100 |
| Irish Points: 2nd | 75 |
| Typical local feis size | 200-400 competitors |
| Large feis size | 1,600+ competitors |
| Stages at local feis | 3-5 simultaneous |
| Dancers per stage set | 2-3 at a time |
| Min competition size for advancement | 5 dancers |
| Complaint fee (grade) | $10 |
| Complaint fee (championship) | $15 / 50 EUR |
| Complaint window | Within 1 hour |
| Results posting time | ~30-60 min after last dancer |
| Drop rule trigger | 5+ judges |
| Recall threshold | Top 50%+1 (100% if <30 dancers) |
| ADCRG minimum age | 30 |
| ADCRG prerequisite | 5+ years as active TCRG |

## Governing Bodies

| Body | Full Name | Scope |
|------|-----------|-------|
| **CLRG** | An Coimisiun le Rinci Gaelacha | Worldwide, HQ Dublin |
| **NAFC** | North American Feis Commission | North America (under CLRG) |
| **IDTANA** | Irish Dance Teachers' Association of North America | Teachers/schools (under CLRG) |
| **WIDA** | World Irish Dance Association | Independent, open platform |
| **An Comhdháil** | An Comhdháil Múinteoirí le Rincí Gaelacha | Ireland, non-CLRG |

## Competition Levels

| Level | Description |
|-------|-------------|
| Beginner (BG) | First year. Soft shoe only. 1 judge, 2 dances. |
| Advanced Beginner (AB) | 1+ years. Adds hard shoe. 1 judge. |
| Novice | Must place 1st in all to advance. 1 judge. |
| Prizewinner (PW) | Must place 1st in all to advance to championship. 1 judge. |
| Preliminary Championship (PC) | First championship level. 3 judges (local). |
| Open Championship (OC) | Highest level. 3-7 judges. Up to 3 rounds with recall. |
