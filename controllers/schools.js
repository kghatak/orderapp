import school from '../models/school.js'
import rollModel from '../models/roll.js';


var schoolListCache = [];

// Helper function for tenant validation
const validateTenantId = (req, res) => {
    if (!req.tenantId) {
        res.status(400).json({ message: "Missing tenant ID in request" });
        return false;
    }
    return true;
};

// Private method to generate a unique DISE Code for a tenant
const generateDISECode = async (tenantId) => {
    console.log("generateDISECode REQUEST REACHED");
    console.log("Tenant ID:", tenantId);

    // Validate tenantId
    if (tenantId !== "c2025-brb") {
        console.error("Invalid tenantId for DISE Code generation");
        throw new Error("DISE Code generation is only allowed for tenantId 'c2025-brb'");
    }

    // Define the prefix for DISE Code
    const prefix = "19080T";

    try {
        // Use the roll collection to generate a unique number
        const rollData = await rollModel.findOneAndUpdate(
            { "rollCode": prefix, "tenantId": tenantId }, // Filter by prefix and tenantId
            { $inc: { maxRoll: 1 } }, // Increment the maxRoll field
            { new: true, upsert: true } // Create a new document if it doesn't exist
        );

        // Generate the DISE Code by concatenating the prefix and the padded roll number
        const paddedRollNumber = rollData.maxRoll.toString().padStart(5, '0');
        const diseCode = `${prefix}${paddedRollNumber}`;

        console.log("Generated DISE Code:", diseCode);
        return diseCode;
    } catch (error) {
        console.error("Error in generateDISECode:", error);
        throw new Error("Failed to generate DISE Code");
    }
};


const getSchools = async (req, res) => {
    console.log("getSchools REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("🔍 DEBUG: req.allowedZone =", req.allowedZone);
    
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    let findParams = { tenantId: req.tenantId, ZoneCode: req.allowedZone }; // Start with tenant filter
    if(req.allowedZone === "ALL") {
        findParams = { tenantId: req.tenantId }; // No zone filter if "ALL"
    }

    console.log("🔍 DEBUG: Final findParams =", findParams);
    
    try {
        const schoolList = await school.find(findParams, {}).sort({ CreatedAt: -1 }); // Sort by createdDate in descending order
        console.log(`🔍 DEBUG: Found ${schoolList.length} schools for tenant: ${req.tenantId}`);
        res.status(200).json(schoolList);

    } catch(error) {
        console.error("Error in getSchools:", error);
        res.status(404).json({ message: error.message });
    }
};

const createSchool = async (req, res) => {
    console.log("createSchool REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // if AutoDise is true, lets generate DISECOde and push it in req.body
    if (req.body.AutoDise) {
        try {
            req.body.DISECode = await generateDISECode(req.tenantId);
        } catch (error) {
            return res.status(400).json({ message: error.message });
        }
    }

    // Validate required fields
    const { SchoolName, DISECode } = req.body;
    if (!SchoolName || !DISECode) {
        return res.status(400).json({ 
            message: "SchoolName and DISECode are required fields" 
        });
    }
    
    // Add tenantId to the school data
    const schoolitem = { 
        ...req.body, 
        tenantId: req.tenantId 
    };

    console.log("School item with tenant:", schoolitem);

    try {
        // Check if school already exists for this tenant
        const existingSchool = await school.findOne({ 
            DISECode: DISECode, 
            tenantId: req.tenantId 
        });
        
        if (existingSchool) {
            return res.status(409).json({ 
                message: "School with this DISE Code already exists for this tenant" 
            });
        }

        const newSchool = await school.create(schoolitem);
        console.log(`School created for tenant ${req.tenantId}:`, newSchool.DISECode);
        res.status(201).json(newSchool);

        // add to cache: This will not work in distributed environment
        schoolListCache.push({  
            "_id": newSchool._id,
            "SchoolName": newSchool.SchoolName,
            "DISECode": newSchool.DISECode,
            "tenantId": newSchool.tenantId
        });

    } catch(error) {
        console.error("Error occurred while saving school:", error);
        res.status(409).json({ message: error.message + " - Save Error" });
    }
};

const getSchoolNames = async (req, res) => {
    console.log("getSchoolNames REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    
    const { SchoolName_like } = req.query;
    console.log(SchoolName_like);

    var queryParams = { tenantId: req.tenantId }; // Start with tenant filter
    if(req.allowedZone != "ALL") {
        queryParams = { ...queryParams, ZoneCode: req.allowedZone }; // Add zone filter if not "ALL"
    }

    if (SchoolName_like != null && SchoolName_like != undefined && SchoolName_like != "") {
        queryParams["SchoolName"] = { $regex: SchoolName_like, $options: 'i' };
    }

    try {
        console.log("Serving from DB with queryParams:", queryParams);
        
        const projection = {
            SchoolName: 1, 
            DISECode: 1, 
            SchoolPOCName: 1,
            SchoolPOCPhoneNumber: 1,
            SchoolPOCEmailAddress: 1,
            ZoneCode: 1,
            tenantId: 1
        };

        const schoolList = await school.find(queryParams, projection);
        console.log(`Found ${schoolList.length} schools for tenant: ${req.tenantId}`);
        res.status(200).json(schoolList);

    } catch(error) {
        console.error("Error in getSchoolNames:", error);
        res.status(404).json({ message: error.message });
    }
}

const getSchool = async (req, res) => {
    console.log("getSchool REQUEST REACHED");
    console.log(req.params.id);
    console.log(req.headers);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate school ID
    if (!req.params.id) {
        return res.status(400).json({ message: "School DISE Code is required" });
    }

    try {
        const schoolData = await school.findOne({ 
            "DISECode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(schoolData) {
            res.status(200).json(schoolData);
        } else {
            res.status(404).json({ message: "School not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in getSchool:", error);
        res.status(404).json({ message: error.message });
    }
};

const updateSchool = async (req, res) => {
    console.log("updateSchool REQUEST REACHED");
    console.log(req.params);
    console.log(req.params.id);
    console.log(req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate school ID
    if (!req.params.id) {
        return res.status(400).json({ message: "School DISE Code is required" });
    }
    
    try {
        // First check if school exists for this tenant
        const schoolItem = await school.findOne({ 
            "DISECode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(schoolItem) {
            // Ensure tenantId cannot be changed in update
            const updateData = { ...req.body };
            delete updateData.tenantId;
            
            const updatedSchool = await school.findOneAndUpdate(
                { 
                    "DISECode": req.params.id,
                    "tenantId": req.tenantId 
                }, 
                updateData, 
                { new: true }
            );
            
            console.log(`School updated for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json(updatedSchool);
        } else {
            res.status(404).json({ message: "School not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in updateSchool:", error);
        res.status(404).json({ message: error.message });
    }
};

const deleteSchool = async (req, res) => {
    console.log("deleteSchool REQUEST REACHED");
    console.log(req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate school ID
    if (!req.params.id) {
        return res.status(400).json({ message: "School DISE Code is required" });
    }
    
    try {
        const schoolData = await school.findOneAndDelete({ 
            "DISECode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(schoolData) {
            console.log(`School deleted for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json({
                message: "School deleted successfully",
                deletedSchool: schoolData
            });
        } else {
            res.status(404).json({ message: "School not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in deleteSchool:", error);
        res.status(404).json({ message: error.message });
    }
};

const getExamCenters = async (req, res) => {
    console.log("getExamCenters REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        const examCenters = await school.find({ 
            ExamCenter: true,
            tenantId: req.tenantId 
        });
        
        const examCenterNames = examCenters.map((school) => 
            school.ZoneCode + "/" + school.DISECode + "/" + school.SchoolName
        );
        
        console.log(`Found ${examCenters.length} exam centers for tenant: ${req.tenantId}`);
        res.status(200).json(examCenterNames);
    } catch (error) {
        console.error("Error in getExamCenters:", error);
        res.status(500).json({ 
            message: 'Failed to fetch Exam Centers', 
            error: error.message 
        });
    }
};

export {
    getSchool, getSchools,
    createSchool, updateSchool,
    deleteSchool, getSchoolNames,
    getExamCenters
};