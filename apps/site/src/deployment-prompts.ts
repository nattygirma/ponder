export const deploymentPrompts = {
  "en-US": `Deploy Ponder entirely through GitHub and Cloudflare:
1. Fork https://github.com/tianma-if/edgeever.
2. Create D1 \`ponder\` and R2 \`ponder-resources\` in Cloudflare.
3. In Workers & Pages, select "Start with Hello World!" and create a Worker named \`ponder\`.
4. Add the user's chosen password as the runtime Secret \`PONDER_AUTH_PASSWORD\`
   under Settings → Variables and Secrets, and deploy the Secret (preferably at least
   32 characters). The username defaults to \`admin\`.
5. Only after the Secret is deployed, open this Worker's Settings → Builds → Connect
   and connect the Fork's \`main\` branch.
6. In Settings → Builds → API token, select or create the Cloudflare API token used for deployment, with D1 read/edit permission for the target account.
7. In the Fork's GitHub repository, open Actions → Update deployed Ponder, enable the workflow if prompted, and select Run workflow on \`main\`. After confirming in Cloudflare that the corresponding build succeeded and deployment completed, verify \`/api/health\` and \`/api/openapi.json\`, then log in with the administrator
   username and password.
   This workflow will automatically sync future stable releases and fixes.`,
} as const;

export const manualDeploymentCopy = {
  "en-US": {
    "intro": "Complete the following 7 web steps strictly in order:",
    "steps": [
      {
        "title": "Fork the Repository",
        "body": "Click Fork at the top right of GitHub to fork Ponder into your personal account."
      },
      {
        "title": "Create Cloudflare Resources",
        "body": "Create D1 ponder and R2 ponder-resources."
      },
      {
        "title": "Create the Worker",
        "body": "In Cloudflare Workers & Pages, select Create application → Start with Hello World!, name the Worker ponder, and deploy it. This creates a placeholder; Ponder is deployed in Step 7."
      },
      {
        "title": "Set the Administrator Password",
        "body": "Under the Worker’s Settings → Variables and Secrets, add PONDER_AUTH_PASSWORD as type Secret and click Deploy. Its value is your chosen login password, preferably at least 32 characters. Complete this before connecting the Fork."
      },
      {
        "title": "Connect the Fork",
        "body": "In the existing Worker’s Settings → Builds → Connect, select the Fork and production branch main."
      },
      {
        "title": "Configure Deployment Permissions",
        "body": "In Settings → Builds → API token, select or create the Cloudflare API token used for deployment, with D1 read/edit permission for the target account."
      },
      {
        "title": "Build & Verify",
        "body": "In the Fork's GitHub repository, open Actions → Update deployed Ponder, enable the workflow if prompted, and select Run workflow on main. After confirming in Cloudflare that the corresponding build succeeded and deployment completed, confirm /api/health returns 200 and verify login. This workflow will automatically sync future stable releases and fixes."
      }
    ]
  },
} as const;
