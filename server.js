const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const { google } = require('googleapis');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Anthropic API
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Google Sheets configuration
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const PROJECT_ID = process.env.GOOGLE_PROJECT_ID;
const PRIVATE_KEY_ID = process.env.GOOGLE_PRIVATE_KEY_ID;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

// Initialize Google Sheets API
const auth = new google.auth.GoogleAuth({
  credentials: {
    type: 'service_account',
    project_id: PROJECT_ID,
    private_key_id: PRIVATE_KEY_ID,
    private_key: PRIVATE_KEY ? PRIVATE_KEY.replace(/\\n/g, '\n') : '',
    client_email: SERVICE_ACCOUNT_EMAIL,
    client_id: CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Use Claude AI to intelligently extract data from message
 */
async function extractDataWithClaude(message) {
  try {
    console.log('Using Claude AI for intelligent extraction...');
    
    const prompt = `You are an expert at extracting property rental/listing information from unstructured messages.

Extract the following information from this message and return ONLY a valid JSON object. 
If a field is not mentioned, use empty string "".
Be smart about understanding context - names are person names, numbers with "k" or "k" are budgets, locations are place names, etc.

Message:
${message}

Return ONLY this JSON (no other text):
{
  "name": "person's name if mentioned",
  "phone": "10-digit phone number without +91 or spaces (e.g., 9880937953)",
  "type": "Tenant or Owner based on context (looking for = Tenant, have property = Owner)",
  "requirement": "Rent or Buy or Lease",
  "configuration": "1BHK, 2BHK, 3BHK, etc. if mentioned",
  "furnishing": "Furnished, Semi-Furnished, Unfurnished if mentioned",
  "location": "primary location/area name",
  "tenantType": "Family, Bachelor, Working Professional if mentioned",
  "budgetRent": "budget amount as mentioned (e.g., '30-35k', '45000', '20-25k including maintenance')",
  "budgetDeposit": "deposit amount if mentioned separately",
  "moveInDate": "move in date if mentioned",
  "parking": "Yes or No or specific parking type if mentioned",
  "foodPref": "Veg or Non-veg if mentioned",
  "notes": "any other important details like work location, pet friendly, power backup, radius, etc."
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Claude API error:', errorData);
      throw new Error(`Claude API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    console.log('Claude response:', data);

    // Extract the JSON from Claude's response
    const responseText = data.content[0].text;
    console.log('Claude text response:', responseText);

    // Try to parse JSON from the response
    let extractedData = {};
    try {
      extractedData = JSON.parse(responseText);
    } catch (parseError) {
      // Try to extract JSON from the response text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extractedData = JSON.parse(jsonMatch[0]);
      } else {
        console.error('Could not parse Claude response as JSON');
        throw parseError;
      }
    }

    console.log('Extracted data:', extractedData);
    return extractedData;

  } catch (error) {
    console.error('Error calling Claude API:', error);
    throw error;
  }
}

/**
 * Add record to Google Sheets
 */
async function addToGoogleSheets(message) {
  try {
    console.log('Starting Google Sheets upload...');

    // Use Claude to extract data
    const parsedData = await extractDataWithClaude(message);

    const customerName = parsedData.name || 'Unknown';
    const customerPhone = parsedData.phone || '';
    const type = parsedData.type || 'Tenant';
    const sheetName = type === 'Owner' ? 'Owner' : 'Tenant';

    console.log(`Detected Type: ${type}`);
    console.log(`Sheet: ${sheetName}`);
    console.log(`Extracted - Name: ${customerName}, Phone: ${customerPhone}`);

    // Prepare row data
    const rowData = [
      new Date().toLocaleDateString('en-IN'),
      customerName,
      customerPhone,
      parsedData.requirement || '',
      parsedData.configuration || '',
      parsedData.furnishing || '',
      parsedData.location || '',
      parsedData.tenantType || '',
      parsedData.budgetRent || '',
      parsedData.budgetDeposit || '',
      parsedData.moveInDate || '',
      parsedData.parking || '',
      parsedData.foodPref || '',
      parsedData.notes || '',
    ];

    console.log('Row data to insert:', rowData);

    // Append to appropriate sheet
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:N`,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowData],
      },
    });

    console.log(`✅ Record added to ${sheetName} sheet`);
    return { success: true, data: parsedData, sheetName };

  } catch (error) {
    console.error('Error adding to Google Sheets:', error.message);
    throw error;
  }
}

/**
 * Send WhatsApp confirmation
 */
async function sendConfirmation(toPhone, type) {
  const confirmationMsg = `✅ Thanks for your inquiry!\n\nYour ${type.toLowerCase()} information has been saved.\n\nWe'll get back to you soon!`;

  try {
    let fromPhone = TWILIO_PHONE;
    if (fromPhone.startsWith('whatsapp:')) {
      fromPhone = fromPhone.replace('whatsapp:', '');
    }

    await client.messages.create({
      from: `whatsapp:${fromPhone}`,
      to: `whatsapp:${toPhone}`,
      body: confirmationMsg,
    });
    console.log(`Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error);
  }
}

/**
 * Main webhook
 */
app.post('/webhook', async (req, res) => {
  const messageBody = req.body.Body;
  const fromPhone = req.body.From.replace('whatsapp:', '');
  const senderName = req.body.ProfileName || 'Unknown';

  console.log(`\n📨 New message from ${senderName} (${fromPhone}):\n${messageBody}\n`);

  try {
    if (!messageBody || messageBody.trim().length < 5) {
      res.sendStatus(200);
      return;
    }

    // Extract data using Claude AI
    const result = await addToGoogleSheets(messageBody);

    // Send confirmation
    await sendConfirmation(fromPhone, result.data.type || 'Tenant');

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing message:', error);
    
    // Send error message to user
    try {
      let fromPhone = TWILIO_PHONE;
      if (fromPhone.startsWith('whatsapp:')) {
        fromPhone = fromPhone.replace('whatsapp:', '');
      }
      
      await client.messages.create({
        from: `whatsapp:${fromPhone}`,
        to: `whatsapp:${fromPhone}`,
        body: `⚠️ There was an error processing your message. Please try again.`
      });
    } catch (sendError) {
      console.error('Could not send error message:', sendError);
    }
    
    res.sendStatus(500);
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ status: 'Bot is running!', claude: 'enabled' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
  console.log(`🧠 Claude AI integration: ENABLED`);
});
