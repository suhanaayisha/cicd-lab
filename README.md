# CI/CD Lab Starter

A small Express and TypeScript app for the CI/CD Crash Course. Use this starting point to follow along with automated testing, GitHub Actions, and deployment to Render.

The starter includes a home page, a health endpoint, and a passing health endpoint test. You will add the combined `verify` script, GitHub Actions workflow, and version endpoint during the course.

## Requirements

- Node.js 24 and npm
- Git
- GitHub and Render accounts for the deployment sections

## Get started

Clone the starter into a new folder:

```bash
git clone https://github.com/bradtraversy/cicd-lab-starter.git cicd-lab
cd cicd-lab
npm ci
```

Start the development server:

```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000). The [health endpoint](http://localhost:3000/api/health) returns HTTP 200 with:

```json
{"status":"ok"}
```

Stop the server with Ctrl+C.

## Scripts

- `npm run dev`: start the development server with automatic restarts.
- `npm run typecheck`: check TypeScript without generating output.
- `npm test`: run the health endpoint test. The test starts and stops its own server.
- `npm run build`: compile the app into `dist`.
- `npm start`: run the compiled app after building it.

## Start your own repository

From inside your newly cloned `cicd-lab` folder, remove the starter's Git history and remote connection, then initialize your own repository. This preserves the app files.

These commands use Bash or Zsh. On Windows, use Git Bash.

```bash
rm -rf .git
git init -b main
git add .
git commit -m "feat: add CI/CD lab starter"
```

Create an empty `cicd-lab` repository on GitHub without a README, license, or gitignore. Replace `YOUR_USERNAME` below with your GitHub username:

```bash
git remote add origin https://github.com/YOUR_USERNAME/cicd-lab.git
git push -u origin main
```

Continue with the course to add verification and deployment. Keep `package-lock.json` committed; dependencies, build output, and environment files are excluded by `.gitignore`.

## Configuration

## Updating the menu

Open [localhost:3000/admin](http://localhost:3000/admin), enter the admin token, and upload a new PDF. The server renders each page to a JPEG, stores the pages and the PDF in S3, and the home page shows the new pages straight away. Until a PDF has been uploaded, the home page shows the bundled pages in `public/menu`.

Uploads need these environment variables:

| Variable | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | Password for the admin page and upload API. |
| `S3_BUCKET` | Bucket that stores uploaded menus. It can stay private; the app serves the images. |
| `S3_ENDPOINT` | S3-compatible endpoint. For Cloudflare R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Leave unset for AWS S3. |
| `AWS_REGION` | `auto` for R2, or the bucket's region for AWS S3. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | An API token with Object Read & Write access to the bucket. |

The same upload works from the command line:

```bash
curl -X PUT http://localhost:3000/api/menu \
  -H 'Content-Type: application/pdf' \
  -H 'Authorization: Bearer change-me' \
  --data-binary @menu.pdf
```

## Configuration

The server uses port `3000` unless `PORT` is set. The home page displays `APP_VERSION`, defaulting to `development`. Neither variable is required to run the starter locally.
