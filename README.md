# Vivek Patil · Portfolio

Personal portfolio site for **Vivek Patil**, a backend, platform, and AI infrastructure engineer.

It's a static site: plain HTML, CSS, and JavaScript with **no build step and no dependencies**. That makes it fast, hard to break, and cheap to host. It's set up for **Azure Static Web Apps (Free plan, $0/month)**.

## What's on the page

| Section | What it does |
| --- | --- |
| Hero | Headline plus an **interactive terminal**: it types `whoami` and `impact`, then visitors can run `help`, `projects`, `stack`, `demo gateway`, `demo sql`, `contact`, and more |
| About | Short story, a facts list, and four headline metrics with count-up animations |
| Skills | Bento grid of six areas, including a to-scale chart of the release cycle going from 28 days to 4 |
| Projects | Filterable gallery (All / Live demo / Open source / At Microsoft). **Two live in-browser demos** open in a dialog: a JavaScript port of the LLM gateway pipeline and a simplified SQL guard from the NL-to-SQL agent |
| Experience | Vertical timeline of roles with impact-focused bullets, an expandable section for extra Microsoft detail, and education |
| Contact | Email with a copy button, LinkedIn and GitHub, and a validated **contact form** (see [Contact form](#contact-form)) |

The design is dark only, by choice. It has a mobile layout, keyboard and screen-reader support, `prefers-reduced-motion` support, Open Graph and social preview tags, and structured data for search engines.

## Project structure

```text
portfolio/
├── index.html                      # the page
├── 404.html                        # not-found page
├── robots.txt
├── staticwebapp.config.json        # Azure SWA: security headers, caching, 404, /resume redirect
├── assets/
│   ├── Vivek_Patil_Resume.pdf      # public resume (no phone number)
│   ├── css/styles.css
│   ├── img/                        # favicon, social preview image, project screenshot
│   └── js/
│       └── main.js                 # terminal, project gallery + both demos, contact form
└── .github/workflows/azure-static-web-apps.yml   # CI/CD to Azure
```

## Run it locally

There's nothing to install. Serve the folder with any static server:

```bash
python -m http.server 5500
```

Then open http://localhost:5500. (Opening `index.html` directly from disk also mostly works, but a server is closer to production.)

## Edit the content

All content is in `index.html`. Search for the section (`<!-- EXPERIENCE -->`, `<!-- PROJECTS -->`, and so on) and edit the text.

- **Projects:** the gallery cards and dialogs are generated from the `PROJECTS` array in `assets/js/main.js`. Each entry has its text, stats, GitHub link, filter tags (`kind`), and an optional live demo.
- **Terminal commands:** the `CMDS` object in `assets/js/main.js`.
- **Resume:** replace `assets/Vivek_Patil_Resume.pdf` and keep the same filename.
- **Social preview image:** `assets/img/og-image.png` (1200×630).

---

## Contact form

Out of the box the form validates input and then gives the visitor a ready-to-send draft (copy button plus an "open in my email app" link). It never claims a message was sent.

To have messages delivered to your inbox:

1. Create a free form at [formspree.io](https://formspree.io) and copy its endpoint, for example `https://formspree.io/f/abcdwxyz`.
2. In `assets/js/main.js`, set `const FORM_ENDPOINT = "https://formspree.io/f/abcdwxyz";`.
3. Push. The Content-Security-Policy in `staticwebapp.config.json` already allows `https://formspree.io`.

The form includes a hidden `_gotcha` field that Formspree uses to filter spam.

## Deploy to Azure Static Web Apps

Pick **one** of the two options below. Option A is recommended: every `git push` then redeploys the site automatically.

### Prerequisites

- An Azure account. The [free account](https://azure.microsoft.com/free) works, and the Static Web Apps **Free** plan costs nothing.
- For option A: a GitHub account.
- For option B: the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) and [Node.js](https://nodejs.org) (for the SWA CLI).

### Option A: GitHub + Azure (recommended)

**1. Push this folder to a new GitHub repository**

```bash
cd D:/git/portfolio
git init -b main
git add .
git commit -m "Initial portfolio"
gh repo create portfolio-site --public --source . --push
```

No `gh` CLI? Create an empty repository on github.com, then run `git remote add origin <url>` and `git push -u origin main`.

**2. Create the Static Web App and get a deployment token**

1. In the [Azure portal](https://portal.azure.com), choose **Create a resource**, search for **Static Web App**, and select **Create**.
2. Fill in the **Basics** tab:
   - **Resource group:** create a new one, e.g. `rg-portfolio`
   - **Name:** e.g. `vivek-portfolio`
   - **Plan type:** **Free**
   - **Deployment source:** **Other**. This repo already contains the GitHub Actions workflow, so choosing "Other" stops Azure from adding a second, duplicate workflow.
3. Select **Review + create**, then **Create**.
4. Open the new resource. Under **Overview**, select **Manage deployment token** and copy the token.

**3. Add the token to GitHub**

In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret**:

- **Name:** `AZURE_STATIC_WEB_APPS_API_TOKEN`
- **Value:** the token you copied

Or with the GitHub CLI:

```bash
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN
```

**4. Deploy**

Push any commit to `main`, or run the workflow by hand from the **Actions** tab (**Deploy to Azure Static Web Apps → Run workflow**). When it finishes, your site's URL is on the Static Web App's **Overview** page. It looks like `https://<random-name>.azurestaticapps.net`.

The workflow also creates a **temporary preview URL for each pull request** and removes it when the PR closes.

> **If you chose "GitHub" as the deployment source instead of "Other":** Azure commits its own workflow file to your repo and sets up the secret for you. That works too, but then delete `.github/workflows/azure-static-web-apps.yml` so the site isn't deployed twice. Set **App location** to `/` and leave **Api location** and **Output location** empty.

### Option B: Deploy from your machine with the CLI (no GitHub needed)

```bash
# 1. Sign in and create the resources
az login
az group create --name rg-portfolio --location westus2
az staticwebapp create --name vivek-portfolio --resource-group rg-portfolio --location westus2 --sku Free

# 2. Get the deployment token
TOKEN=$(az staticwebapp secrets list --name vivek-portfolio --resource-group rg-portfolio --query "properties.apiKey" -o tsv)

# 3. Deploy this folder to production
npx @azure/static-web-apps-cli deploy . --deployment-token "$TOKEN" --env production
```

PowerShell uses a different syntax for step 2:

```powershell
$TOKEN = az staticwebapp secrets list --name vivek-portfolio --resource-group rg-portfolio --query "properties.apiKey" -o tsv
npx @azure/static-web-apps-cli deploy . --deployment-token $TOKEN --env production
```

Run the `deploy` command again whenever you change the site. Get the site URL with:

```bash
az staticwebapp show --name vivek-portfolio --resource-group rg-portfolio --query "defaultHostname" -o tsv
```

### Add a custom domain (optional, recommended)

A domain like `vivekpatil.dev` looks more professional on a resume than `*.azurestaticapps.net`. Azure provides and renews the HTTPS certificate for free.

1. Buy a domain from any registrar (Namecheap, Cloudflare, GoDaddy, and so on).
2. In the Static Web App, open **Custom domains → Add → Custom domain on other DNS**.
3. For a subdomain like `www.vivekpatil.dev`, create a **CNAME** record at your registrar pointing to your `*.azurestaticapps.net` hostname. For the root domain (`vivekpatil.dev`), follow the portal's **TXT record** validation steps, then add an **ALIAS/ANAME** record, or an A record if your registrar doesn't support ALIAS.
4. Wait for validation. It usually takes minutes, occasionally up to a few hours.

CLI equivalent for a subdomain, after creating the CNAME:

```bash
az staticwebapp hostname set --name vivek-portfolio --resource-group rg-portfolio --hostname www.vivekpatil.dev
```

### After the first deploy

1. **Keep the social preview URLs current.** `index.html` uses absolute URLs for `canonical`, `og:url`, `og:image`, and the JSON-LD `url`, pointing at `https://gray-rock-07b8c501e.6.azurestaticapps.net/`. If you add a custom domain, search for that hostname and replace it.
2. **Check the preview** with LinkedIn's [Post Inspector](https://www.linkedin.com/post-inspector/). This also refreshes LinkedIn's cached copy of the page.
3. **Share the link:**
   - LinkedIn: **Edit intro → Contact info → Website**, and add it to your **Featured** section.
   - Add it to your resume header and your GitHub profile.
4. **Check the security headers** at [securityheaders.com](https://securityheaders.com). The config sets a strict Content-Security-Policy, HSTS, `nosniff`, a referrer policy, and a permissions policy.

`/resume` redirects to the resume PDF, so `https://<your-domain>/resume` makes a short link for emails.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| Workflow fails with "deployment token" error | The `AZURE_STATIC_WEB_APPS_API_TOKEN` secret is missing or out of date. Reset the token in the portal and update the secret. |
| Two deployments run on every push | Azure added its own workflow file as well as this one. Delete one of them. |
| Changes don't show up | Hard-refresh the page (Ctrl+F5). Files under `/assets/` are cached for 7 days, so rename a file (e.g. `styles.v2.css`) if you need it to update immediately for everyone. |
| Fonts or scripts are blocked | You added an external resource. Allow its domain in the `Content-Security-Policy` in `staticwebapp.config.json`. |
| Custom domain stuck on "Validating" | Check the DNS record with `nslookup www.yourdomain.com`. DNS changes can take a while to spread. |

## Tech notes

- **No framework.** Under 500 lines of vanilla JavaScript across four files. The page works without JavaScript too: all content is in the HTML, and the demos simply don't run.
- **The demos are honest.** Both are labeled as simplified in-browser versions. The measured results shown on each card come from the real Python projects' benchmarks.
- **Privacy.** The public resume PDF has no phone number, and the site uses no analytics or cookies.
