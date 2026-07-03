const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  nameBangla: {
    type: String,
    required: true,
  },
  helperRoles: {
    type: [String],
    required: true,
  },
});

module.exports = mongoose.model("Service", serviceSchema);