# Setting up AZURE_CREDENTIALS for GitHub Actions

Since basic authentication is disabled, we need to use service principal authentication.

## Step-by-Step Instructions:

### 1. Create App Registration (Service Principal)

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for **"Microsoft Entra ID"** (or "Azure Active Directory")
3. Click on **"App registrations"** in the left menu
4. Click **"+ New registration"**
5. Fill in:
   - **Name**: `github-actions-orderapp`
   - **Supported account types**: Select "Accounts in this organizational directory only"
   - Click **"Register"**

### 2. Get Client ID and Tenant ID

After registration, you'll see the overview page:
- Copy the **Application (client) ID** - you'll need this
- Copy the **Directory (tenant) ID** - you'll need this too

### 3. Create Client Secret

1. In the same app registration, go to **"Certificates & secrets"** in the left menu
2. Click **"+ New client secret"**
3. Fill in:
   - **Description**: `GitHub Actions Secret`
   - **Expires**: Choose "12 months" (or your preference)
4. Click **"Add"**
5. **IMPORTANT**: Copy the **Value** immediately (you won't see it again!)

### 4. Assign Contributor Role

1. Go to **"Subscriptions"** in Azure Portal
2. Select your subscription: **"Service 360 Test"** (ID: 8cff5c8a-98f3-44ad-b300-2d44716c802c)
3. Click **"Access control (IAM)"** in the left menu
4. Click **"+ Add"** → **"Add role assignment"**
5. Fill in:
   - **Role**: Select **"Contributor"**
   - **Assign access to**: Select **"User, group, or service principal"**
   - **Select**: Search for `github-actions-orderapp` and select it
6. Click **"Review + assign"** → **"Review + assign"** again

### 5. Create JSON for GitHub Secret

Create a JSON with the following format (replace with your actual values):

```json
{
  "clientId": "YOUR_APPLICATION_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET_VALUE",
  "subscriptionId": "8cff5c8a-98f3-44ad-b300-2d44716c802c",
  "tenantId": "YOUR_DIRECTORY_TENANT_ID"
}
```

### 6. Add Secret to GitHub

1. Go to your GitHub repository: https://github.com/kghatak/orderapp
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Fill in:
   - **Name**: `AZURE_CREDENTIALS`
   - **Secret**: Paste the entire JSON from step 5
5. Click **"Add secret"**

## That's it!

Once you've added the secret, your GitHub Actions workflow will be able to authenticate with Azure and deploy your app.

