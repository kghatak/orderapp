// controllers/productController.js
import { getFirestoreDB } from '../../util/firebase.js';
import { categoryIconMap } from '../../util/iconMapper.js';

// Generate Product ID in format PROD-00001 using counters collection
const generateProductId = async (db) => {
  const counterRef = db.collection('counters').doc('products');
  let newCounter = 1;

  await db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    if (counterDoc.exists) {
      newCounter = (counterDoc.data().count || 0) + 1;
    }
    transaction.set(counterRef, { count: newCounter }, { merge: true });
  });

  return `PROD-${newCounter.toString().padStart(5, '0')}`;
};

// Create Product
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      price,
      unit,
      quantity,
      gst,
      sgst,
      type,
      category,
      actualQuantity,
      availableQuantity,
      active,
      icon
    } = req.body;

    // Validation for required fields
    if (!name || !price || !unit || !type || !category) {
      return res.status(400).json({ error: 'Name, price, unit, type, and category are required' });
    }

    // Validate type
    if (type !== 'Returnable' && type !== 'Non-Returnable') {
      return res.status(400).json({ error: 'Type must be either "Returnable" or "Non-Returnable"' });
    }

    // Validate category
    const validCategories = [
      'Dairy Product',
      'Sweets/Desserts', 
      'Ghee Products',
      'Specialty Items',
      'Savory Snacks'
    ];
    
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category. Must be one of: Dairy Product, Sweets/Desserts, Ghee Products, Specialty Items, Savory Snacks' 
      });
    }

    const db = getFirestoreDB();
    const productId = await generateProductId(db);
    
    // Use provided icon or get from category mapping
    let finalIcon = icon;
    if (!finalIcon) {
      finalIcon = categoryIconMap[category] || '';
    }

    // Handle quantity fields
    const finalActualQuantity = actualQuantity !== undefined ? actualQuantity : (quantity || 0);
    const finalAvailableQuantity = availableQuantity !== undefined ? availableQuantity : (quantity || 0);
    
    const productData = {
      productId,
      name,
      price,
      unit,
      actualQuantity: finalActualQuantity,
      availableQuantity: finalAvailableQuantity,
      gst: gst || 0,
      sgst: sgst || 0,
      type,
      icon: finalIcon,
      category,
      active: active !== undefined ? active : true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection('products').doc(productId).set(productData);
    res.status(201).json({ message: 'Product created', id: productId });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

// Get Product by ID
export const getProductById = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    const doc = await db.collection('products').doc(id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('Get product error:', err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// Get All Products with advanced filtering
export const getAllProducts = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const { filters, name_like, _start, _end, page, limit } = req.query; // Get all query parameters
    
    let snapshot;
    let products = [];
    
    // Get all products first
    snapshot = await db.collection('products').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    
    // Handle name_like parameter (backward compatibility)
    if (name_like && name_like.trim()) {
      console.log(`Applying name_like filter: "${name_like}"`);
      const searchTerm = name_like.trim().toLowerCase();
      products = products.filter(product => 
        product.name && product.name.toLowerCase().includes(searchTerm)
      );
      console.log(`After name_like filter: ${products.length} products remaining`);
    }
    
    // Apply advanced filters if provided
    if (filters && Array.isArray(filters)) {
      console.log('Applying advanced filters:', filters);
      
      // Apply each filter
      for (const filter of filters) {
        const { field, operator, value } = filter;
        
        if (!field || !operator || value === undefined) {
          console.warn('Invalid filter:', filter);
          continue;
        }
        
        console.log(`Applying filter: ${field} ${operator} "${value}"`);
        
        // Filter products based on the filter criteria
        products = products.filter(product => {
          const fieldValue = product[field];
          
          // Handle case where field doesn't exist
          if (fieldValue === undefined || fieldValue === null) {
            return false;
          }
          
          switch (operator) {
            case 'contains':
              // Case-insensitive contains search
              return String(fieldValue).toLowerCase().includes(String(value).toLowerCase());
              
            case 'equals':
              // Case-insensitive exact match
              return String(fieldValue).toLowerCase() === String(value).toLowerCase();
              
            case 'starts_with':
              // Case-insensitive starts with
              return String(fieldValue).toLowerCase().startsWith(String(value).toLowerCase());
              
            case 'ends_with':
              // Case-insensitive ends with
              return String(fieldValue).toLowerCase().endsWith(String(value).toLowerCase());
              
            case 'greater_than':
              // Numeric comparison
              return Number(fieldValue) > Number(value);
              
            case 'less_than':
              // Numeric comparison
              return Number(fieldValue) < Number(value);
              
            case 'greater_than_or_equal':
              // Numeric comparison
              return Number(fieldValue) >= Number(value);
              
            case 'less_than_or_equal':
              // Numeric comparison
              return Number(fieldValue) <= Number(value);
              
            default:
              console.warn(`Unknown operator: ${operator}`);
              return true; // Don't filter if operator is unknown
          }
        });
        
        console.log(`After filter "${field} ${operator} ${value}": ${products.length} products remaining`);
      }
    }
    
    // Apply pagination
    let paginatedProducts = products;
    let paginationInfo = null;
    
    // Support both old (_start, _end) and new (page, limit) pagination
    if (page !== undefined && limit !== undefined) {
      // New pagination format
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const offset = (pageNum - 1) * limitNum;
      
      paginatedProducts = products.slice(offset, offset + limitNum);
      paginationInfo = {
        currentPage: pageNum,
        totalPages: Math.ceil(products.length / limitNum),
        totalCount: products.length,
        hasNextPage: pageNum < Math.ceil(products.length / limitNum),
        hasPrevPage: pageNum > 1,
        limit: limitNum
      };
      
      console.log(`Page-based pagination: page ${pageNum}, limit ${limitNum} (${paginatedProducts.length} products)`);
    } else if (_start !== undefined && _end !== undefined) {
      // Legacy pagination format (for backward compatibility)
      const start = parseInt(_start) || 0;
      const end = parseInt(_end) || products.length;
      
      // If end is 0 or negative, return all products
      if (end <= 0) {
        paginatedProducts = products;
        console.log(`Pagination disabled: returning all ${products.length} products`);
      } else {
        paginatedProducts = products.slice(start, end);
        console.log(`Legacy pagination: ${start} to ${end} (${paginatedProducts.length} products)`);
      }
    }
    
    console.log(`Final result: ${paginatedProducts.length} products (total available: ${products.length})`);
    
    // Set headers that Refine framework expects for pagination
    res.set('X-Total-Count', products.length.toString());
    res.set('Access-Control-Expose-Headers', 'X-Total-Count');
    
    // Return products with pagination info if using new format
    if (paginationInfo) {
      res.status(200).json({
        products: paginatedProducts,
        pagination: paginationInfo
      });
    } else {
      // Return products in the same format as before for backward compatibility
      res.status(200).json(paginatedProducts);
    }
    
  } catch (error) {
    console.error('Fetch products error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

// Update Product
export const updateProduct = async (req, res) => {
  try {
    const {
      name,
      price,
      unit,
      quantity,
      gst,
      sgst,
      type,
      category,
      actualQuantity,
      availableQuantity,
      active,
      icon
    } = req.body;

    const db = getFirestoreDB();
    const id = req.params.id;

    // Check if product exists
    const docRef = db.collection('products').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updateData = {};

    // Validate and update name
    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'Name cannot be empty' });
      }
      updateData.name = name;
    }

    // Validate and update price
    if (price !== undefined) {
      if (typeof price !== 'number' || price < 0) {
        return res.status(400).json({ error: 'Price must be a positive number' });
      }
      updateData.price = price;
    }

    // Validate and update unit
    if (unit !== undefined) {
      if (!unit.trim()) {
        return res.status(400).json({ error: 'Unit cannot be empty' });
      }
      updateData.unit = unit;
    }

    // Validate and update quantity
    if (quantity !== undefined) {
      if (typeof quantity !== 'number' || quantity < 0) {
        return res.status(400).json({ error: 'Quantity must be a positive number' });
      }
      updateData.actualQuantity = quantity;
      updateData.availableQuantity = quantity;
    }

    // Validate and update gst
    if (gst !== undefined) {
      if (typeof gst !== 'number' || gst < 0) {
        return res.status(400).json({ error: 'GST must be a positive number' });
      }
      updateData.gst = gst;
    }

    // Validate and update sgst
    if (sgst !== undefined) {
      if (typeof sgst !== 'number' || sgst < 0) {
        return res.status(400).json({ error: 'SGST must be a positive number' });
      }
      updateData.sgst = sgst;
    }

    // Validate and update type
    if (type !== undefined) {
      if (type !== 'Returnable' && type !== 'Non-Returnable') {
        return res.status(400).json({ error: 'Type must be either "Returnable" or "Non-Returnable"' });
      }
      updateData.type = type;
    }

    // Validate and update category
    if (category !== undefined) {
      const validCategories = [
        'Dairy Product',
        'Sweets/Desserts', 
        'Ghee Products',
        'Specialty Items',
        'Savory Snacks'
      ];
      
      if (!validCategories.includes(category)) {
        return res.status(400).json({ 
          error: 'Invalid category. Must be one of: Dairy Product, Sweets/Desserts, Ghee Products, Specialty Items, Savory Snacks' 
        });
      }
      updateData.category = category;

      // Update icon based on category
      let icon = '';
      switch (category) {
        case 'Dairy Product':
          icon = 'milk';
          break;
        case 'Sweets/Desserts':
          icon = 'sweet';
          break;
        case 'Ghee Products':
          icon = 'ghee';
          break;
        case 'Specialty Items':
          icon = 'sweet_box';
          break;
        case 'Savory Snacks':
          icon = 'namkeen';
          break;
        default:
          icon = 'sweet'; // default fallback
      }
      updateData.icon = icon;
    }

    // Validate and update actualQuantity
    if (actualQuantity !== undefined) {
      if (typeof actualQuantity !== 'number' || actualQuantity < 0) {
        return res.status(400).json({ error: 'Actual quantity must be a positive number' });
      }
      updateData.actualQuantity = actualQuantity;
    }

    // Validate and update availableQuantity
    if (availableQuantity !== undefined) {
      if (typeof availableQuantity !== 'number' || availableQuantity < 0) {
        return res.status(400).json({ error: 'Available quantity must be a positive number' });
      }
      updateData.availableQuantity = availableQuantity;
    }

    // Validate and update active status
    if (active !== undefined) {
      if (typeof active !== 'boolean') {
        return res.status(400).json({ error: 'Active must be a boolean value' });
      }
      updateData.active = active;
    }

    // Validate and update icon (if provided directly)
    if (icon !== undefined && !category) {
      // Only allow icon update if category is not being updated (to avoid conflicts)
      const validIcons = ['milk', 'sweet', 'ghee', 'sweet_box', 'namkeen'];
      if (!validIcons.includes(icon)) {
        return res.status(400).json({ 
          error: 'Invalid icon. Must be one of: milk, sweet, ghee, sweet_box, namkeen' 
        });
      }
      updateData.icon = icon;
    }

    // Add updated timestamp
    updateData.updatedAt = new Date();

    // Only update if there are fields to update
    if (Object.keys(updateData).length > 0) {
      await docRef.update(updateData);
    }

    res.status(200).json({ 
      success: true,
      message: 'Product updated successfully',
      productId: id,
      updatedFields: Object.keys(updateData)
    });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};


// Delete Product
export const deleteProduct = async (req, res) => {
  try {
    const db = getFirestoreDB();
    const id = req.params.id;
    await db.collection('products').doc(id).delete();
    res.status(200).json({ message: 'Product deleted' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

// Bulk Create Products from JSON
export const bulkCreateProducts = async (req, res) => {
  try {
    const { products } = req.body;

    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ 
        success: false,
        message: 'Request body must contain a "products" array' 
      });
    }

    if (products.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Products array cannot be empty' 
      });
    }

    const results = {
      total: products.length,
      successful: 0,
      failed: 0,
      errors: [],
      successfulProducts: []
    };

    const db = getFirestoreDB();
    const validCategories = [
      'Dairy Product',
      'Sweets/Desserts', 
      'Ghee Products',
      'Specialty Items',
      'Savory Snacks'
    ];

    // Process each product
    for (let i = 0; i < products.length; i++) {
      const productData = products[i];
      const rowNumber = i + 1;

      try {
        // Validate required fields
        if (!productData.name || !productData.price || !productData.unit || !productData.type || !productData.category) {
          results.errors.push({
            row: rowNumber,
            error: 'Missing required fields: name, price, unit, type, and category are required'
          });
          results.failed++;
          continue;
        }

        // Validate type
        if (productData.type !== 'Returnable' && productData.type !== 'Non-Returnable') {
          results.errors.push({
            row: rowNumber,
            error: 'Type must be either "Returnable" or "Non-Returnable"'
          });
          results.failed++;
          continue;
        }

        // Validate category
        if (!validCategories.includes(productData.category)) {
          results.errors.push({
            row: rowNumber,
            error: `Invalid category. Must be one of: ${validCategories.join(', ')}`
          });
          results.failed++;
          continue;
        }

        // Validate numeric fields
        const price = parseFloat(productData.price);
        const gst = parseFloat(productData.gst || 0);
        const sgst = parseFloat(productData.sgst || 0);
        const actualQuantity = parseFloat(productData.actualQuantity || 0);
        const availableQuantity = parseFloat(productData.availableQuantity || 0);

        if (isNaN(price) || price < 0) {
          results.errors.push({
            row: rowNumber,
            error: 'Price must be a valid positive number'
          });
          results.failed++;
          continue;
        }

        if (isNaN(gst) || gst < 0) {
          results.errors.push({
            row: rowNumber,
            error: 'GST must be a valid positive number'
          });
          results.failed++;
          continue;
        }

        if (isNaN(sgst) || sgst < 0) {
          results.errors.push({
            row: rowNumber,
            error: 'SGST must be a valid positive number'
          });
          results.failed++;
          continue;
        }

        if (isNaN(actualQuantity) || actualQuantity < 0) {
          results.errors.push({
            row: rowNumber,
            error: 'Actual quantity must be a valid positive number'
          });
          results.failed++;
          continue;
        }

        if (isNaN(availableQuantity) || availableQuantity < 0) {
          results.errors.push({
            row: rowNumber,
            error: 'Available quantity must be a valid positive number'
          });
          results.failed++;
          continue;
        }

        // Generate product ID
        const productId = await generateProductId(db);

        // Use provided icon or get from category mapping
        let icon = productData.icon;
        if (!icon) {
          icon = categoryIconMap[productData.category] || '';
        }

        // Create product data
        const newProductData = {
          productId,
          name: productData.name.trim(),
          price,
          unit: productData.unit.trim(),
          actualQuantity,
          availableQuantity: availableQuantity || actualQuantity,
          gst,
          sgst,
          type: productData.type,
          icon,
          category: productData.category,
          active: productData.active !== undefined ? productData.active : true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Save to database
        await db.collection('products').doc(productId).set(newProductData);

        results.successful++;
        results.successfulProducts.push({
          row: rowNumber,
          productId: productId,
          name: productData.name,
          category: productData.category,
          fullProductData: newProductData
        });

      } catch (error) {
        console.error(`Error processing row ${rowNumber}:`, error);
        results.errors.push({
          row: rowNumber,
          error: error.message
        });
        results.failed++;
      }
    }

    // Send response
    res.status(200).json({
      success: true,
      message: `Bulk import completed. ${results.successful} products imported successfully, ${results.failed} failed.`,
      results: results,
      importedProducts: results.successfulProducts.map(item => item.fullProductData),
      summary: {
        total: results.total,
        successful: results.successful,
        failed: results.failed
      }
    });

  } catch (error) {
    console.error('Bulk import error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error: ' + error.message 
    });
  }
};

// Bulk Delete Products
export const bulkDeleteProducts = async (req, res) => {
  try {
    const { productIds } = req.body;

    if (!productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ 
        success: false,
        message: 'Request body must contain a "productIds" array' 
      });
    }

    if (productIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Product IDs array cannot be empty' 
      });
    }

    const results = {
      total: productIds.length,
      successful: 0,
      failed: 0,
      errors: [],
      successfulDeletions: []
    };

    const db = getFirestoreDB();

    // Process each product ID
    for (let i = 0; i < productIds.length; i++) {
      const productId = productIds[i];
      const rowNumber = i + 1;

      try {
        // Validate product ID format
        if (!productId || typeof productId !== 'string' || productId.trim() === '') {
          results.errors.push({
            row: rowNumber,
            productId: productId,
            error: 'Invalid product ID: must be a non-empty string'
          });
          results.failed++;
          continue;
        }

        // Check if product exists
        const docRef = db.collection('products').doc(productId);
        const docSnap = await docRef.get();
        
        if (!docSnap.exists) {
          results.errors.push({
            row: rowNumber,
            productId: productId,
            error: 'Product not found'
          });
          results.failed++;
          continue;
        }

        // Get product data before deletion for response
        const productData = docSnap.data();

        // Delete the product
        await docRef.delete();

        results.successful++;
        results.successfulDeletions.push({
          row: rowNumber,
          productId: productId,
          productName: productData.name || 'Unknown',
          category: productData.category || 'Unknown'
        });

      } catch (error) {
        console.error(`Error deleting product ${productId} at row ${rowNumber}:`, error);
        results.errors.push({
          row: rowNumber,
          productId: productId,
          error: error.message
        });
        results.failed++;
      }
    }

    // Send response
    res.status(200).json({
      success: true,
      message: `Bulk delete completed. ${results.successful} products deleted successfully, ${results.failed} failed.`,
      results: results,
      summary: {
        total: results.total,
        successful: results.successful,
        failed: results.failed
      }
    });

  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error: ' + error.message 
    });
  }
};
