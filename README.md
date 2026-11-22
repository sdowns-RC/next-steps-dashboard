# Next Steps Lobby Dashboard

A full-screen lobby display for each Radiant location, laid out as a newcomer's path:
1. **Start here:** next Be Radiant class, First Steps sessions, water baptism, child dedication, prayer meetings
2. **Grow in a class:** the upcoming Wednesday Night at Radiant term, each class with a one-line description and seat status, plus Students, Kids Discipleship and Childcare
3. **Find your people:** active groups by Gather / Grow / Go, split into Men / Women / Young Adult / Coed, plus global and local outreach

Data comes from Planning Center and refreshes automatically every Saturday night.

**Screen links (after setup):**
- Portage: `https://<your-github-name>.github.io/<repo-name>/?campus=portage`
- Richland: `https://<your-github-name>.github.io/<repo-name>/?campus=richland`

---

## One-time setup (about 15 minutes)

### 1. Create a Planning Center token
1. Go to **api.planningcenteronline.com/oauth/applications** and sign in.
2. Under **Personal Access Tokens**, click **New Personal Access Token**. Name it "Next Steps Dashboard".
3. Copy the **Application ID** and **Secret**. The secret is only shown once.

> The token can see whatever the account that created it can see. The dashboard only reads data, but the safest option is to create the token from a staff login that has view access to Registrations and Groups only.

### 2. Put the code on GitHub
1. Create a new **public** repository (for example `next-steps-dashboard`). GitHub Pages is free only for public repos. Nothing private gets published, just class names, seat counts and group totals.
2. Upload everything in this folder, including the hidden `.github` folder. (Or ask Claude to push it for you once the repo exists.)

### 3. Add the token as secrets
Go to **Settings → Secrets and variables → Actions → New repository secret** and add:
- `PCO_APP_ID` = the Application ID
- `PCO_SECRET` = the Secret

### 4. Turn on GitHub Pages
Go to **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.

### 5. Run it the first time
Go to **Actions → Refresh dashboard → Run workflow**. When it turns green, open the screen links above.

---

## On the TV
- Open the link in any full-screen browser. Good options include a Chromecast or Fire TV stick with a kiosk browser app, or a small PC or Raspberry Pi running Chrome in kiosk mode.
- The page fits any screen size. It re-reads the data every 30 minutes, reloads itself daily around 4 AM, and shifts a few pixels every 10 minutes to protect against burn-in.
- If the internet drops, the last data stays on screen.

## Day-to-day
- **Refresh now:** Actions → Refresh dashboard → Run workflow.
- **Things to check:** each weekly run lists anything that looks off (a missing baptism date, a typo'd class date, a term with no live classes). It appears in the run's summary page on GitHub.
- **Refresh daily instead of weekly:** in `.github/workflows/refresh.yml`, change `"17 4 * * 0"` to `"17 4 * * *"`.
- **Heads-up:** GitHub may pause scheduled runs on a repo with no activity for 60 days. If that happens, you'll get an email, and one click on **Enable workflow** turns it back on.

## Seat status
- **Open:** plenty of room
- **N spots left · Almost full:** 5 or fewer seats, or a quarter or less of the class
- **Full · Join the waitlist:** no seats left (the waitlist line shows only if the class has a waitlist)

## Editing the wording
- **Class descriptions:** `CLASS_INFO` near the top of `scripts/build-data.mjs`. A new class without one still shows, and the weekly run flags it.
- **Group descriptions, Prayer Room, Students/Kids/Childcare, outreach and footer text:** in `index.html`.

## How it reads Planning Center
| Screen section | Where it comes from |
|---|---|
| WNAR | Registrations signups named "Wednesday Night at Radiant …" tagged to the campus. It shows the term starting soonest, and only classes that are public with seats set above 0. |
| Groups | Active groups whose type is Gather, Grow or Go. The category comes from the group name: "young adult / college / young women / young professional" counts as **Young Adult** (this wins over Men/Women); "women / moms / mothers / sisters" counts as **Women**; "men / fathers" counts as **Men**; anything else counts as **Coed**. These are church-wide totals. |
| Be Radiant / Baptism / Child Dedication | The next future date on any Registrations signup with "Be Radiant", "baptism" or "dedication" in its name, either for that campus or untagged. If there's none, the card says "New date coming soon." |

Rules and campus IDs live at the top of `scripts/build-data.mjs`. Brand colors live at the top of `index.html`.

## Brand
- Colors: black `#000000`, Radiant orange `#EF3F29`, wordmark white `#F2EEED`, cream `#E5D8C6`.
- Logo: `radiant-logo.png` (official orange/white logo).
- Font: Proxima Nova (Regular, Semibold, Bold, Extrabold) in `/fonts` as web fonts.
