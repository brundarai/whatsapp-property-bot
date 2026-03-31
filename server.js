const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize clients
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Airtable headers
const airtableHeaders = {
  Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  'Content-Type': 'application/json',
};

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
  "furnishing": "Furnished or Semi-Furnished or Unfurnished (SINGLE VALUE)",
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
  "furnishing": "Furnished or Semi-Furnished or Unfurnished (SINGLE VALUE)",
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
    console.error('Error extracting info:', error);
    return null;
  }
}

/**
 * Check if record already exists in Airtable
 */
async function checkDuplicate(type, phone, name) {
  const tableName = type === 'tenant' ? 'Tenants' : 'Owners';
  const filterFormula = `AND({Phone} = "${phone}")`;
  
  try {
    const response = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}`,
      {
        headers: airtableHeaders,
        params: {
          filterByFormula: filterFormula,
        },
      }
    );

    return response.data.records.length > 0;
  } catch (error) {
    console.error('Error checking duplicate:', error.message);
    return false;
  }
}

/**
 * Add record to Airtable
 */
async function addToAirtable(type, data) {
  const tableName = type === 'tenant' ? 'Tenants' : 'Owners';
  
  // Helper function to filter out null/undefined values
  const cleanFields = (obj) => {
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    }
    return cleaned;
  };

  let fields = {};

  if (type === 'tenant') {
    fields = {
      Phone: data.phone || undefined,
      Configuration: data.configuration || undefined,
      Furnishing: data.furnishing || undefined,
      Locations: (data.locations && data.locations.length > 0) ? data.locations.join(', ') : undefined,
      BudgetMin: data.budget_min || undefined,
      BudgetMax: data.budget_max || undefined,
      TenantType: data.tenant_type || undefined,
      MoveInDate: data.move_in_date || undefined,
      ParkingNeeded: data.parking_needed !== null ? (data.parking_needed ? 'Yes' : 'No') : undefined,
      Pets: data.pets !== null ? (data.pets ? 'Yes' : 'No') : undefined,
      SpecialRequirements: data.special_requirements || undefined,
    };
  } else {
    // Owners table fields
    fields = {
      Name: data.name || undefined,
      Phone: data.phone || undefined,
      Configuration: data.configuration || undefined,
      Furnishing: data.furnishing || undefined,
      Location: data.location || undefined,
      Rental: data.rental || undefined,
      Deposit: data.deposit || undefined,
      Maintenance: data.maintenance || undefined,
      Parking: data.parking || undefined,
      PetsAllowed: data.pets_allowed !== null ? data.pets_allowed : undefined,
      MoveInDate: data.move_in_date || undefined,
      OccupancyType: data.occupancy_type || undefined,
      SpecialRestrictions: data.special_restrictions || undefined,
    };
  }

  // Remove undefined values before sending
  fields = cleanFields(fields);

  try {
    const response = await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}`,
      { fields },
      { headers: airtableHeaders }
    );

    return response.data.id;
  } catch (error) {
    const airtableError = error.response?.data?.error;
    if (airtableError) {
      console.error('❌ Airtable Error:', airtableError);
    } else {
      console.error('❌ Error adding to Airtable:', error.message);
    }
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
    console.log(`Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error);
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

    // Skip duplicate check due to API permission issues
    // console.log('🔍 Step 2: Checking for duplicates...');
    // const isDuplicate = await checkDuplicate(extractedData.type, fromPhone, extractedData.name);
    // if (isDuplicate) {
    //   console.log(`⚠️ Duplicate entry detected for ${extractedData.name}. Skipping.`);
    //   res.sendStatus(200);
    //   return;
    // }
    console.log('⏭️ Step 2: Skipping duplicate check (API permissions)');
    console.log('🔍 Step 3: Adding to Airtable...');
    const recordId = await addToAirtable(extractedData.type, extractedData);
    console.log(`✅ Record added to Airtable: ${recordId}`);

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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
});
