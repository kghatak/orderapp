# OrderApp

Independent server application forked from JBJApp master snapshot.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   - Copy `.env` and update with your configuration
   - Update MongoDB URI if needed
   - Update any API keys as required

3. Start the server:
   ```bash
   npm start
   ```

## Development

This app was created as an independent fork from JBJApp. You can now:
- Develop features independently
- Maintain separate git history
- Deploy separately
- Customize as needed without affecting JBJApp

## Next Steps

1. **Set up remote repository** (optional):
   ```bash
   git remote add origin <your-orderapp-repo-url>
   git push -u origin master
   ```

2. **Update configuration**:
   - Review and update `.env` file
   - Update MongoDB connection strings
   - Update any service-specific configurations

3. **Customize the application**:
   - Remove unused routes/controllers if needed
   - Add orderapp-specific features
   - Update branding/documentation

4. **Set up CI/CD** (if needed):
   - Update `.github/workflows/azure-webapp.yml` with new app name
   - Configure deployment settings
