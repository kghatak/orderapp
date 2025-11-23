# GitHub Actions Azure Deployment Setup Guide

This guide will help you configure GitHub Actions to automatically deploy your Node.js application to Azure Web App.

## Prerequisites

1. An Azure subscription
2. A GitHub repository
3. Azure CLI installed locally (for initial setup)

## Step 1: Create Azure Web App

If you haven't created your Azure Web App yet, create one:

```bash
# Create a resource group
az group create --name orderapp-rg --location "East US"

# Create an App Service plan
az appservice plan create --name orderapp-plan --resource-group orderapp-rg --sku B1 --is-linux

# Create the web app
az webapp create --resource-group orderapp-rg --plan orderapp-plan --name orderapp --runtime "NODE:20-lts"
```

## Step 2: Configure GitHub Secrets

### 2.1 Create Service Principal (Already Done)

The service principal has been created with the following details:
- **Name**: orderapp-github-actions
- **Role**: Contributor
- **Scope**: Your subscription

> **Important**: The actual service principal credentials were generated during setup but are not included in this documentation for security reasons. Use the output from the `az ad sp create-for-rbac` command that was run earlier.

### 2.2 Add GitHub Repository Secrets

Go to your GitHub repository settings and add the following secrets:

1. **Navigate to**: Your GitHub repo → Settings → Secrets and variables → Actions
2. **Click**: "New repository secret"
3. **Add the following secret**:

**Secret Name**: `AZURE_CREDENTIALS`
**Secret Value**: 
```json
{
  "clientId": "YOUR_CLIENT_ID_FROM_SERVICE_PRINCIPAL_OUTPUT",
  "clientSecret": "YOUR_CLIENT_SECRET_FROM_SERVICE_PRINCIPAL_OUTPUT",
  "subscriptionId": "YOUR_AZURE_SUBSCRIPTION_ID",
  "tenantId": "YOUR_TENANT_ID_FROM_SERVICE_PRINCIPAL_OUTPUT",
  "activeDirectoryEndpointUrl": "https://login.microsoftonline.com",
  "resourceManagerEndpointUrl": "https://management.azure.com/",
  "activeDirectoryGraphResourceId": "https://graph.windows.net/",
  "sqlManagementEndpointUrl": "https://management.core.windows.net:8443/",
  "galleryEndpointUrl": "https://gallery.azure.com/",
  "managementEndpointUrl": "https://management.core.windows.net/"
}
```

> **Note**: Replace the placeholder values with the actual credentials from the service principal creation output. The actual values should be kept secure and only added to GitHub Secrets, never committed to the repository.

⚠️ **IMPORTANT**: Keep these credentials secure and never commit them to your repository!

## Step 3: Configure Environment Variables in Azure

Set up your application's environment variables in the Azure Web App:

```bash
# Example: Set MongoDB connection string
az webapp config appsettings set --resource-group orderapp-rg --name orderapp --settings MONGODB_URI="your-mongodb-connection-string"

# Set Node.js version
az webapp config appsettings set --resource-group orderapp-rg --name orderapp --settings WEBSITE_NODE_DEFAULT_VERSION="20.x"

# Set other environment variables as needed
az webapp config appsettings set --resource-group orderapp-rg --name orderapp --settings NODE_ENV="production"
```

## Step 4: Test the Deployment

1. **Push to development branch**: The workflow will trigger automatically
2. **Manual trigger**: Go to Actions tab in GitHub → Select workflow → Run workflow
3. **Monitor**: Check the Actions tab for deployment progress

## Step 5: Verify Deployment

After successful deployment:

1. Visit your app at: `https://orderapp.azurewebsites.net`
2. Check Azure Portal → App Services → orderapp → Overview for status
3. View logs: Azure Portal → App Services → orderapp → Log stream

## Workflow Features

The updated workflow includes:

- ✅ **Caching**: NPM dependencies are cached for faster builds
- ✅ **Production optimization**: Only production dependencies in final package
- ✅ **Environment URL**: Automatic deployment URL in GitHub
- ✅ **Manual trigger**: Can be triggered manually via GitHub UI
- ✅ **Proper cleanup**: Azure logout after deployment
- ✅ **Error handling**: Continues even if optional steps fail

## Troubleshooting

### Common Issues:

1. **Authentication Error**: Verify AZURE_CREDENTIALS secret is correctly formatted
2. **App Name Not Found**: Ensure the Azure Web App name matches in the workflow
3. **Build Failures**: Check that all dependencies are properly listed in package.json
4. **Runtime Errors**: Review application logs in Azure Portal

### Debug Commands:

```bash
# Check if web app exists
az webapp show --resource-group orderapp-rg --name orderapp

# View deployment logs
az webapp log tail --resource-group orderapp-rg --name orderapp

# List app settings
az webapp config appsettings list --resource-group orderapp-rg --name orderapp
```

## Security Best Practices

1. **Secrets Management**: Never hardcode secrets in your code
2. **Least Privilege**: Service principal has only necessary permissions
3. **Environment Variables**: Store sensitive config in Azure App Settings
4. **Regular Rotation**: Rotate service principal secrets periodically
5. **Monitoring**: Enable Application Insights for monitoring

## Next Steps

1. Set up staging environments
2. Add automated testing
3. Configure Application Insights
4. Set up database connections
5. Configure custom domains and SSL

For more advanced scenarios, consider using Azure DevOps or GitHub Environments for better deployment management.