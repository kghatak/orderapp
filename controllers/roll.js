import rollModel from "../models/roll.js"
// write upsert logic for a given ExamCode, SchoolCode and Class
// if the roll is already present, update the maxRoll
// if the roll is not present, create a new roll
const updateRoll = async (req, res) => {
    console.log("upsertRoll REQUEST REACHED");
    console.log(req.params.id);

    try {

      const rollData = await rollModel.findOneAndUpdate({ "rollCode" : req.params.id}, 
                        { $inc: { maxRoll: 1 } },
                        { new: true, upsert: true });

      // concatenate all the three fields and return it as rollNumber
      const rollNumber = req.params.id + '-' + rollData.maxRoll;
      console.log(rollNumber);

      res.status(200).json({ rollNumber: rollNumber, 
                             rollNumberRaw: rollData.maxRoll,
                             rollKey: req.params.id });
        
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
};

export { updateRoll };