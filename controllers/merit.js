import Merit from '../models/merit.js';
import fs from 'fs';
import pdf from 'html-pdf' ;

const getMerits = async (req, res) => {
    try {
        const meritList = await Merit.find();
        res.status(200).json(meritList);
    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const createMerit = async (req, res) => {
    const meritItem = req.body;
    const newMerit = new Merit(meritItem);

    try {
        await newMerit.save();
        res.status(200).json(newMerit);
    } catch(error) {
        res.status(409).json({ message: error.message });
    }
};

const getMerit = async (req, res) => {
    try {
        const meritData = await Merit.findOne({ "roll_no": req.params.id });
        if (meritData) {
            res.status(200).json(meritData);
        } else {
            res.status(404).json({ message: "Merit not found" });
        }
    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const updateMerit = async (req, res) => {
    try {
        const updatedMerit = await Merit.findOneAndUpdate({ "roll_no": req.params.id }, req.body, { new: true });
        res.status(200).json(updatedMerit);
    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const deleteMerit = async (req, res) => {
    try {
        await Merit.deleteOne({ "roll_no": req.params.id });
        res.status(200).json({ message: "Merit deleted successfully" });
    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};
const downloadMerit = async(req, res) => {
   console.log(req.params)
    var html = fs.readFileSync('assets/marksCard.html', 'utf8');

    const createPdf = pdf.create(html).toBuffer(function(err, buffer){
    const pdfBase64 = Buffer.from(buffer).toString('base64');
    res.status(200).json({data: pdfBase64});
    });
}
  
export {
    getMerit, getMerits,
    createMerit, updateMerit,
    deleteMerit,downloadMerit
};
