// util/tenantMiddleware.js
export function tenantMiddleware(req, res, next) {
  var tenantId = req.headers['user-tenantid'];
  var allowedZone = req.headers['user-zone'];

  console.log("Received tenant ID from header:", tenantId);
  console.log("Received zone info from header:", allowedZone === undefined ? "ALL" : allowedZone);

  // For development purposes, you can set a default tenantId if not provided
  if (!tenantId) {
    //return res.status(400).json({ error: 'Missing tenant ID in header' });
    console.log("Missing tenant ID in header");
    //tenantId = "c2023-jgm";
    //tenantId = "c2025-brb";
  } else {
    console.log("Tenant ID:", tenantId);
  }

  if (allowedZone === undefined || allowedZone === null || allowedZone.trim() === "") {
    // If zone info is missing, default to "ALL"
    console.log("Missing zone info in header");
    allowedZone = "ALL";
  } else {
    console.log("Zone Info:", allowedZone);
  }

  console.log("Final received for tenant:", tenantId);
  console.log("Final received for Zone:", allowedZone);

  req.tenantId = tenantId;
  req.allowedZone = allowedZone;

  next();
}