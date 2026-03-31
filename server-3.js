const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize clients
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Excel file paths
const TENANTS_FILE = path.join(__dirname, 'tenants.xlsx');
const OWNERS_FILE = path.join(__dirname, 'owners.xlsx');

/**
 * Initialize Excel files with headers
 */
async function initializeExcelFiles() {
  // Initialize Tenants file
  if (!fs.existsSync(TENANTS_FILE)) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Tenants');
    sheet.columns = [
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Configuration', key: 'configuration', width: 12 },
      { header: 'Furnishing', key: 'furnishing', width: 15 },
      { header: 'Locations', key: 'locations', width: 25 },
      { header: 'Budget Min', key: 'budget_min', width: 12 },
      { header: 'Budget Max', key: 'budget_max', width: 12 },
      { header: 'Tenant Type', key: 'tenant_type', width: 12 },
      { header: 'Move-in Date', key: 'move_in_date', width: 15 },
      { header: 'Parking Needed', key: 'parking_needed', width: 12 },
      { header: 'Pets', key: 'pets', width: 10 },
      { header: 'Special Requirements', key: 'special_requirements', width: 25 },
      { header: 'Confidence', key: 'confidence', width: 10 },
      { header: 'Date Added', key: 'date_added', width: 15 },
    ];
    // Style header row
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    await workbook.xlsx.writeFile(TENANTS_FILE);
    console.log('✅ Tenants Excel file created');
  }

  // Initialize Owners file
  if (!fs.existsSync(OWNERS_FILE)) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Owners');
    sheet.columns = [
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Name', key: 'name', width: 20 },
      { header: 'Configuration', key: 'configuration', width: 12 },
      { header: 'Furnishing', key: 'furnishing', width: 15 },
      { header: 'Location', key: 'location', width: 25 },
      { header: 'Rental', key: 'rental', width: 10 },
      { header: 'Deposit', key: 'deposit', width: 10 },
      { header: 'Maintenance', key: 'maintenance', width: 12 },
      { header: 'Parking', key: 'parking', width: 12 },
      { header: 'Pets Allowed', key: 'pets_allowed', width: 12 },
      { header: 'Move-in Date', key: 'move_in_date', width: 15 },
      { header: 'Occupancy Type', key: 'occupancy_type', width: 15 },
      { header: 'Special Restrictions', key: 'special_restrictions', width: 25 },
      { header: 'Confidence', key: 'confidence', width: 10 },
      { header: 'Date Added', key: 'date_added', width: 15 },
    ];
    // Style header row
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
    await workbook.xlsx.writeFile(OWNERS_FILE);
    console.log('✅ Owners Excel file created');
  }
}

/**
 * Extract tenant/owner info using Claude AI
 */
async function extractPropertyInfo(messageText, senderPhone, senderName) {
  const systemPrompt = `You are an AI assistant that extracts property rental information from WhatsApp messages.
Extract the following information and return ONLY valid JSON (no markdown, no explanation):

For TENANTS:
{
  "type": "tenant",
  "name": "person's name or null",
  "phone": "phone number or null",
  "configuration": "1 BHK or 2 BHK or 3 BHK or 4 BHK or 5 BHK (SINGLE VALUE ONLY, with space)",
  "furnishing": "Furnished or Semi Furnished or Unfurnished (SINGLE VALUE, use space not hyphen)",
  "locations": ["location1", "location2"],
  "budget_min": number or null,
  "budget_max": number or null,
  "tenant_type": "Bachelor or Family or Student (SINGLE VALUE)",
  "move_in_date": "date or null",
  "parking_needed": true/false or null,
  "pets": true/false or null,
  "special_requirements": "string or null",
  "confidence": 0.8
}

For OWNERS:
{
  "type": "owner",
  "name": "owner's name or null",
  "phone": "phone number or null",
  "configuration": "1 BHK or 2 BHK or 3 BHK or 4 BHK or 5 BHK (SINGLE VALUE ONLY, with space)",
  "furnishing": "Furnished or Semi Furnished or Unfurnished (SINGLE VALUE, use space not hyphen)",
  "location": "property location or null",
  "rental": number or null,
  "deposit": number or null,
  "maintenance": number or null,
  "parking": "2-wheeler or Car or Both or None (SINGLE VALUE)",
  "pets_allowed": true/false or null,
  "move_in_date": "date or null",
  "occupancy_type": "Bachelor or Family or Any (SINGLE VALUE)",
  "special_restrictions": "string or null",
  "confidence": 0.8
}

CRITICAL RULES:
- Extract phone numbers EXACTLY as they appear
- For budget/rental/deposit/maintenance, extract as integers (remove 'k', rupee symbol, etc)
- For configuration, ALWAYS use format "X BHK" with a SPACE between number and BHK (e.g., "1 BHK" NOT "1BHK")
- For furnishing, parking, occupancy_type: extract ONLY ONE value (not multiple, not comma-separated)
- If multiple values mentioned (e.g. "2 BHK or 3 BHK"), pick the FIRST one mentioned
- If information is missing, use null
- Return ONLY the JSON object, nothing else
- Always use confidence 0.8 or higher`;

  const userPrompt = `Extract information from this WhatsApp message:
Sender Phone: ${senderPhone}
Sender Name: ${senderName}
Message: ${messageText}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const extractedData = JSON.parse(cleanedText);
    
    return extractedData;
  } catch (error) {
    console.error('Error extracting info:', error.message);
    return null;
  }
}

/**
 * Add record to Excel file
 */
async function addToExcel(type, data) {
  const filePath = type === 'tenant' ? TENANTS_FILE : OWNERS_FILE;
  
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];
    
    // Prepare row data
    const rowData = {
      phone: data.phone || '',
      name: data.name || '',
      date_added: new Date().toLocaleString(),
    };

    if (type === 'tenant') {
      rowData.configuration = data.configuration || '';
      rowData.furnishing = data.furnishing || '';
      rowData.locations = (data.locations && data.locations.length > 0) ? data.locations.join(', ') : '';
      rowData.budget_min = data.budget_min || '';
      rowData.budget_max = data.budget_max || '';
      rowData.tenant_type = data.tenant_type || '';
      rowData.move_in_date = data.move_in_date || '';
      rowData.parking_needed = data.parking_needed ? 'Yes' : (data.parking_needed === false ? 'No' : '');
      rowData.pets = data.pets ? 'Yes' : (data.pets === false ? 'No' : '');
      rowData.special_requirements = data.special_requirements || '';
    } else {
      rowData.configuration = data.configuration || '';
      rowData.furnishing = data.furnishing || '';
      rowData.location = data.location || '';
      rowData.rental = data.rental || '';
      rowData.deposit = data.deposit || '';
      rowData.maintenance = data.maintenance || '';
      rowData.parking = data.parking || '';
      rowData.pets_allowed = data.pets_allowed ? 'Yes' : (data.pets_allowed === false ? 'No' : '');
      rowData.move_in_date = data.move_in_date || '';
      rowData.occupancy_type = data.occupancy_type || '';
      rowData.special_restrictions = data.special_restrictions || '';
    }

    rowData.confidence = data.confidence || 0;

    // Add row to sheet
    sheet.addRow(rowData);

    // Save file
    await workbook.xlsx.writeFile(filePath);
    console.log(`✅ Record added to Excel: ${type}`);
    return true;
  } catch (error) {
    console.error('Error adding to Excel:', error.message);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone, type, name, details) {
  const message = type === 'tenant'
    ? `✅ Got it! I've saved your requirements:\n\n📋 Name: ${name}\n🏠 Looking for: ${details.configuration || 'Any'}\n📍 Location: ${details.locations?.join(', ') || 'Not specified'}\n💰 Budget: ₹${details.budget_min || '?'}k - ₹${details.budget_max || '?'}k\n\nI'll notify you when matching properties are available!`
    : `✅ Property saved!\n\n🏠 ${details.configuration} in ${details.location}\n💰 Rent: ₹${details.rental || '?'}k\n📞 Contact: ${name}\n\nI'll connect interested tenants with you!`;

  try {
    await client.messages.create({
      from: `whatsapp:${TWILIO_PHONE}`,
      to: `whatsapp:${toPhone}`,
      body: message,
    });
    console.log(`✅ Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error.message);
  }
}

/**
 * Main webhook endpoint for Twilio
 */
app.post('/webhook', async (req, res) => {
  const messageBody = req.body.Body;
  const fromPhone = req.body.From.replace('whatsapp:', '');
  const senderName = req.body.ProfileName || 'Unknown';

  console.log(`\n📨 New message from ${senderName} (${fromPhone}):\n${messageBody}\n`);

  try {
    console.log('🔍 Step 1: Extracting data with Claude...');
    const extractedData = await extractPropertyInfo(messageBody, fromPhone, senderName);
    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));

    if (!extractedData) {
      console.log('❌ No data extracted (extractedData is null). Skipping.');
      res.sendStatus(200);
      return;
    }

    if (extractedData.confidence < 0.5) {
      console.log(`⚠️ Low confidence (${extractedData.confidence}). Skipping.`);
      res.sendStatus(200);
      return;
    }

    console.log(`✅ Confidence: ${extractedData.confidence}`);
    console.log(`✅ Type: ${extractedData.type}`);

    console.log('⏭️ Step 2: Skipping duplicate check');
    console.log('🔍 Step 3: Adding to Excel...');
    await addToExcel(extractedData.type, extractedData);
    console.log(`✅ Record saved to Excel!`);

    console.log('🔍 Step 4: Sending WhatsApp confirmation...');
    await sendConfirmation(fromPhone, extractedData.type, extractedData.name || senderName, extractedData);
    console.log(`✅ Confirmation sent to ${fromPhone}`);

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error processing message:', error.message);
    console.error('Full error:', error);
    res.sendStatus(500);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'Bot is running!' });
});

// Initialize Excel files and start server
async function startServer() {
  try {
    await initializeExcelFiles();
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
