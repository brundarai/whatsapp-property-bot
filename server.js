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
  "configuration": "1BHK, 2BHK, 3BHK etc or null",
  "furnishing": "Furnished, Semi-Furnished, Unfurnished or null",
  "locations": ["location1", "location2"],
  "budget_min": number or null,
  "budget_max": number or null,
  "tenant_type": "Bachelor, Family, Student etc or null",
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
  "configuration": "1BHK, 2BHK, 3BHK etc or null",
  "furnishing": "Furnished, Semi-Furnished, Unfurnished or null",
  "location": "property location or null",
  "rental": number or null,
  "deposit": number or null,
  "maintenance": number or null,
  "parking": "2-wheeler, Car, Both, None or null",
  "pets_allowed": true/false or null,
  "move_in_date": "date or null",
  "occupancy_type": "Bachelor, Family, Any etc or null",
  "special_restrictions": "string or null",
  "confidence": 0.8
}

RULES:
- Extract phone numbers EXACTLY as they appear
- For budget, extract as integers (remove 'k', rupee symbol, etc)
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
  
  let fields = {
    Name: data.name || 'Unknown',
    Phone: data.phone || '',
  };

  if (type === 'tenant') {
    fields = {
      ...fields,
      Configuration: data.configuration || '',
      Furnishing: data.furnishing || '',
      Locations: (data.locations || []).join(', '),
      BudgetMin: data.budget_min || '',
      BudgetMax: data.budget_max || '',
      TenantType: data.tenant_type || '',
      MoveInDate: data.move_in_date || '',
      ParkingNeeded: data.parking_needed ? 'Yes' : 'No',
      Pets: data.pets ? 'Yes' : 'No',
      SpecialRequirements: data.special_requirements || '',
      Confidence: data.confidence || 0,
    };
  } else {
    fields = {
      ...fields,
      Configuration: data.configuration || '',
      Furnishing: data.furnishing || '',
      Location: data.location || '',
      Rental: data.rental || '',
      Deposit: data.deposit || '',
      Maintenance: data.maintenance || '',
      Parking: data.parking || '',
      PetsAllowed: data.pets_allowed ? 'Yes' : 'No',
      MoveInDate: data.move_in_date || '',
      OccupancyType: data.occupancy_type || '',
      SpecialRestrictions: data.special_restrictions || '',
      Confidence: data.confidence || 0,
    };
  }

  try {
    const response = await axios.post(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableName}`,
      { fields },
      { headers: airtableHeaders }
    );

    return response.data.id;
  } catch (error) {
    console.error('Error adding to Airtable:', error.response?.data || error.message);
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
    const extractedData = await extractPropertyInfo(messageBody, fromPhone, senderName);
    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));

    if (!extractedData || extractedData.confidence < 0.5) {
      console.log('Low confidence or invalid data. Skipping.');
      res.sendStatus(200);
      return;
    }

    const isDuplicate = await checkDuplicate(extractedData.type, fromPhone, extractedData.name);
    
    if (isDuplicate) {
      console.log(`Duplicate entry detected for ${extractedData.name}`);
      res.sendStatus(200);
      return;
    }

    const recordId = await addToAirtable(extractedData.type, extractedData);
    console.log(`✅ Record added to Airtable: ${recordId}`);

    await sendConfirmation(fromPhone, extractedData.type, extractedData.name || senderName, extractedData);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing message:', error);
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
