import UserModel from '../models/user.js'

// Helper function for tenant validation (optional for users since some operations may not require tenant)
const validateTenantId = (req, res, required = true) => {
    if (required && !req.tenantId) {
        res.status(400).json({ message: "Missing tenant ID in request" });
        return false;
    }
    return true;
};

const getUser = async (req, res) => {
    
    // Add log statements here
    console.log("getUser REQUEST REACHED");
    // extract the id from the request
    console.log(req.params.id);

    try {
        const user = await UserModel.findOne({ "email" : req.params.id  });
        if(user) {
            // Add log statements here
            console.log(user);
            res.status(200).json(user);
        } else {
            res.status(404).json({ message: "User Not found" });
        }
    } catch(error) {
        res.status(404).json({ message: error.message });
    }
    
};

const getUsers = async (req, res) => {
    console.log("getUsers REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    
    // Validate tenant - required for listing users
    if (!validateTenantId(req, res)) return;
    
    try {
        // Find all users for the current tenant
        const userList = await UserModel.find({ "tenantId": req.tenantId });
        console.log(`Found ${userList.length} users for tenant: ${req.tenantId}`);
        res.status(200).json(userList);

    } catch(error) {
        console.error("Error in getUsers:", error);
        res.status(404).json({ message: error.message });
    }
};

const createUser = async (req, res) => {
    console.log("createUser REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    
    // Validate tenant - required for creating users
    if (!validateTenantId(req, res)) return;
    
    const useritem = req.body; 
    const {name, email, role } = req.body;
    
    // Validate required fields
    if (!email) {
        return res.status(400).json({ 
            message: "Email is required" 
        });
    }

    // Add tenantId to user data
    useritem.tenantId = req.tenantId;
    
    console.log("### User item with tenant:", useritem);

    try{
        // Check if user exists globally first (email should be unique across all tenants)
        const userExists = await UserModel.findOne({ "email" : req.body.email });
        if (userExists) {
            console.log("User already exists with this email");
            // Check if the existing user belongs to the same tenant
            if (userExists.tenantId === req.tenantId) {
                console.log("User exists in the same tenant");
                res.status(200).json(userExists);
            } else {
                console.log("User exists in different tenant - email conflict");
                res.status(409).json({ 
                    message: "User with this email already exists in another tenant" 
                });
            }
        } else {
            const newUser = new UserModel(useritem);
            console.log("### Saving User Data");
            
            await newUser.save();
            console.log(`User created for tenant ${req.tenantId}:`, newUser.email);
            res.status(201).json(newUser);
        }

    } catch( error ) {
        console.error("Error occurred while saving user:", error);
        res.status(500).json({ message: error.message + " - Save Error" });
    }
};

const updateUser = async (req, res) => {
    console.log("updateUser REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("User Email:", req.params.id);
    console.log("Update Data:", req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate email
    if (!req.params.id) {
        return res.status(400).json({ message: "User email is required" });
    }
    
    try {
        const userData = await UserModel.findOne({ 
            "email": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(userData) {
            // Ensure tenantId and email cannot be changed in update
            const updateData = { ...req.body };
            delete updateData.tenantId;
            delete updateData.email;
            
            const updatedUser = await UserModel.findOneAndUpdate(
                { 
                    "email": req.params.id,
                    "tenantId": req.tenantId 
                }, 
                updateData, 
                { new: true }
            );
            
            console.log(`User updated for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json(updatedUser);
        } else {
            res.status(404).json({ message: "User not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in updateUser:", error);
        res.status(404).json({ message: error.message });
    }
};

const deleteUser = async (req, res) => {
    console.log("deleteUser REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("User Email:", req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const userEmailToDelete = req.params.id;
    
    // Validate email
    if (!userEmailToDelete) {
        return res.status(400).json({ message: "User email is required" });
    }

    try {
        const deletedUser = await UserModel.findOneAndDelete({ 
            "email": userEmailToDelete,
            "tenantId": req.tenantId 
        });
        
        if (deletedUser) {
            console.log(`User deleted for tenant ${req.tenantId}:`, userEmailToDelete);
            res.status(200).json({ 
                message: "User deleted successfully",
                deletedUser: deletedUser 
            });
        } else {
            res.status(404).json({ message: "User not found for this tenant" });
        }
    } catch (error) {
        console.error("Error in deleteUser:", error);
        res.status(500).json({ message: error.message });
    }
};


export {
    getUser, getUsers,
    createUser, deleteUser
};
