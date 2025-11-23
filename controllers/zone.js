import zone from '../models/zone.js';
import axios from 'axios';

// Helper function for tenant validation
const validateTenantId = (req, res) => {
    if (!req.tenantId) {
        res.status(400).json({ message: "Missing tenant ID in request" });
        return false;
    }
    return true;
};

// write async for getZones
const getZones = async (req, res) => {
    console.log("getZones REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("🔍 DEBUG: Headers =", req.headers['user-tenantid']);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        console.log("🔍 DEBUG: About to query with tenantId:", req.tenantId);
        const zoneList = await zone.find({ tenantId: req.tenantId }, {});
        console.log(`🔍 DEBUG: Found ${zoneList.length} zones for tenant: ${req.tenantId}`);
        console.log("🔍 DEBUG: Zone tenantIds found:", zoneList.map(z => z.tenantId));
        res.status(200).json(zoneList);

    } catch(error) {
        console.error("Error in getZones:", error);
        res.status(404).json({ message: error.message });
    }
}

const getZone = async (req, res) => {
    console.log("getZone REQUEST REACHED");
    console.log(req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate zone ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Zone ID is required" });
    }
    
    try {
        const zoneData = await zone.findOne({ 
            "ZoneCode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(zoneData) {
            res.status(200).json(zoneData);
        } else {
            res.status(404).json({ message: "Zone not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in getZone:", error);
        res.status(404).json({ message: error.message });
    }
}

// write async for createZone
const createZone = async (req, res) => {
    console.log("createZone REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate required fields
    const { ZoneCode, ZoneName } = req.body;
    if (!ZoneCode || !ZoneName) {
        return res.status(400).json({ 
            message: "ZoneCode and ZoneName are required fields" 
        });
    }
    
    // Add tenantId to the zone data
    const zoneitem = { 
        ...req.body, 
        tenantId: req.tenantId 
    };

    console.log("Zone item with tenant:", zoneitem);

    try {
        // Check if zone already exists for this tenant
        const existingZone = await zone.findOne({ 
            ZoneCode: ZoneCode, 
            tenantId: req.tenantId 
        });
        
        if (existingZone) {
            return res.status(409).json({ 
                message: "Zone with this code already exists for this tenant" 
            });
        }

        const newZone = await zone.create(zoneitem);
        console.log(`Zone created for tenant ${req.tenantId}:`, newZone.ZoneCode);
        res.status(201).json(newZone);

    } catch(error) {
        console.error("Error occurred while saving zone:", error);
        res.status(409).json({ message: error.message + " - Save Error" });
    }    
}

// Write for updateZone
const updateZone = async (req, res) => {
    console.log("updateZone REQUEST REACHED");
    console.log(req.params.id);
    console.log(req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate zone ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Zone ID is required" });
    }
    
    try {
        // First check if zone exists for this tenant
        const zoneData = await zone.findOne({ 
            "ZoneCode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(zoneData) {
            // Ensure tenantId cannot be changed in update
            const updateData = { ...req.body };
            delete updateData.tenantId;
            
            const updatedZone = await zone.updateOne(
                { 
                    "ZoneCode": req.params.id,
                    "tenantId": req.tenantId 
                }, 
                updateData
            );
            
            console.log(`Zone updated for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json(updatedZone);
        } else {
            res.status(404).json({ message: "Zone not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in updateZone:", error);
        res.status(404).json({ message: error.message });
    }
}

// Write for deleteZone
const deleteZone = async (req, res) => {
    console.log("deleteZone REQUEST REACHED");
    console.log(req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate zone ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Zone ID is required" });
    }
    
    try {
        // First check if zone exists for this tenant
        const zoneData = await zone.findOne({ 
            "ZoneCode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(zoneData) {
            const deletedZone = await zone.deleteOne({ 
                "ZoneCode": req.params.id,
                "tenantId": req.tenantId 
            });
            
            console.log(`Zone deleted for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json({ 
                message: "Zone deleted successfully",
                deletedCount: deletedZone.deletedCount 
            });
        } else {
            res.status(404).json({ message: "Zone not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in deleteZone:", error);
        res.status(404).json({ message: error.message }); 
    }
}

// write async for GeoCode
const getLatLngForZone = async (req, res) => {
    console.log("getLatLngForZone REQUEST REACHED");
    
    const zoneName = req.params.zoneName;
    console.log(zoneName);
  
    try {
        // Replace 'YOUR_API_KEY' with your actual Google Maps Geocoding API key
        const apiKey = 'AIzaSyCxakLgdhUOXnusKt8MFun9JAK7qeKwmhU';
  
        // Make a request to the Google Maps Geocoding API
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: {
                address: zoneName,
                key: apiKey,
            },
        }).then((response) => {
            // Check if the response was successful
            console.log(response);
            if (response.data.status === 'OK') {
                // Extract the latitude and longitude
                const { lat, lng } = response.data.results[0].geometry.location;
                // Return the latitude and longitude as JSON
                res.status(200).json({ latitude: lat, longitude: lng });
            } else {
                res.status(404).json({ message: 'Zone not found or unable to retrieve coordinates' });
            }
        }).catch((error) => {
            console.log(error);
            res.status(500).json({ message: 'Internal server error from Promise' });
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: 'Internal server error from Try/catch' });
    }
};
  

export { getZone, getZones, createZone, updateZone, deleteZone, getLatLngForZone };

