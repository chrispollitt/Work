// I want to use npm's jsdom to interact with a WordPress site that uses these WP plugins for a workshop calendar site:
// 
// * The Events Calendar
// * Event Tickets Plus
// 
// Sadly, we must assume the WP web-APIs have been disabled.
// 
// Let's assume I'm a WP-Admin and have access to the Attendee's list and want to export it.
// Here is an example sequence of URLs to scrape and then follow. 
// In this case I want the next interview-skills workshop participant list:
// 
// * https://midtown.pcrs.ca/calendar/
// * https://midtown.pcrs.ca/event/job-search-day-3-interview-skills-east-24/
// * https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=27068
// * https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=27068&attendees_csv=1&attendees_csv_nonce=87237473d0
// 
// We need to scrape the subsequent URLs as only the fist is stable.
// 
// . ~/_/OneDrive-PCRS/dev/node/nodevars.sh
// npm install jsdom node-fetch inquirer
// node export-attendees.js [--debug]

const path = require('path');

/// USER SERVICEABLE PARTS (USP) /////////////////////////////

const workshopTypes = [
  'Basic Life',
  'Essential Work',
  'Career Planning',
  'Resume',
  'Interview',
  'Networking',
  'Education'
];

const CREDS_FILE = path.join(process.env.USERPROFILE, '.wp_creds');
const ENCRYPTION_KEY = 'ThisIsTheKeyToEverythingShhhhh'; 

/// END USP ////////////////////////////////////////////////////

const { JSDOM } = require('jsdom');
const fetch = globalThis.fetch;
const fs = require('fs');
const inquirer = require('inquirer');
const { createPromptModule } = inquirer;
const prompt = createPromptModule();
const crypto = require('crypto');
const { promisify } = require('util');

// Parse command line arguments
const DEBUG_MODE = process.argv.includes('--debug') || process.argv.includes('-d');
const DEBUG_DIR = path.join(process.env.USERPROFILE, 'Downloads', 'debug-export');

// Store cookies for authenticated requests
let cookies = [];

/// DEBUGGING FUNCTIONS /////////////////////////////////////

function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log('[DEBUG]', ...args);
  }
}

function ensureDebugDir() {
  if (DEBUG_MODE && !fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    debugLog(`Created debug directory: ${DEBUG_DIR}`);
  }
}

function saveDebugFile(filename, content, description = '') {
  if (!DEBUG_MODE) return;
  
  ensureDebugDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugFilename = `${timestamp}-${filename}`;
  const fullPath = path.join(DEBUG_DIR, debugFilename);
  
  try {
    fs.writeFileSync(fullPath, content, 'utf8');
    debugLog(`Saved ${description || filename} to: ${fullPath}`);
    return fullPath;
  } catch (error) {
    debugLog(`Failed to save debug file ${filename}:`, error.message);
  }
}

function saveCookiesDebug(step) {
  if (!DEBUG_MODE) return;
  
  const cookieData = {
    step,
    timestamp: new Date().toISOString(),
    cookies: cookies.map(cookie => {
      // Parse cookie for better debugging
      const [nameValue, ...attributes] = cookie.split(';');
      const [name, value] = nameValue.split('=');
      return {
        name: name?.trim(),
        value: value?.trim(),
        full: cookie
      };
    })
  };
  
  saveDebugFile(`cookies-${step}.json`, JSON.stringify(cookieData, null, 2), `cookies after ${step}`);
}

/// FUNCTIONS /////////////////////////////////////////////////////

// Simple encryption/decryption functions using recommended methods
function encrypt(text) {
  const algorithm = 'aes-256-ctr';
  const secretKey = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData) {
  try {
    const algorithm = 'aes-256-ctr';
    const secretKey = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    
    const [ivHex, encrypted] = encryptedData.split(':');
    if (!ivHex || !encrypted) {
      // Handle old format without IV
      debugLog('Using legacy decryption method for old credential format');
      const decipher = crypto.createDecipher(algorithm, ENCRYPTION_KEY);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    }
    
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    debugLog('Decryption failed:', error.message);
    return null;
  }
}

// Save credentials to file
function saveCredentials(username, password) {
  const data = JSON.stringify({
    username,
    password
  });
  
  const encrypted = encrypt(data);
  fs.writeFileSync(CREDS_FILE, encrypted);
  console.log('Credentials saved securely');
  debugLog(`Credentials saved to: ${CREDS_FILE}`);
}

// Load credentials from file
function loadCredentials() {
  try {
    if (!fs.existsSync(CREDS_FILE)) {
      debugLog('No credentials file found');
      return null;
    }
    
    debugLog(`Loading credentials from: ${CREDS_FILE}`);
    const encrypted = fs.readFileSync(CREDS_FILE, 'utf8');
    const decrypted = decrypt(encrypted);
    
    if (!decrypted) {
      debugLog('Failed to decrypt credentials');
      return null;
    }
    
    const creds = JSON.parse(decrypted);
    debugLog(`Loaded credentials for user: ${creds.username}`);
    return creds;
  } catch (error) {
    console.error('Error loading credentials:', error.message);
    debugLog('Credentials loading error details:', error);
    return null;
  }
}

// Prompt for credentials if needed
async function getCredentials() {
  // Try to load existing credentials
  const saved = loadCredentials();
  if (saved) {
    return saved;
  }
  
  debugLog('Prompting user for new credentials');
  
  // Prompt for new credentials
  const credentials = await prompt([
    {
      type: 'input',
      name: 'username',
      message: 'Enter your WordPress username:',
      validate: input => input.length > 0 ? true : 'Username is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Enter your WordPress password:',
      mask: '*',
      validate: input => input.length > 0 ? true : 'Password is required'
    },
    {
      type: 'confirm',
      name: 'save',
      message: 'Save credentials for future use?',
      default: true
    }
  ]);
  
  // Save if requested
  if (credentials.save) {
    saveCredentials(credentials.username, credentials.password);
  }
  
  return {
    username: credentials.username,
    password: credentials.password
  };
}

// Update cookies from response
function updateCookies(response) {
  // Get all set-cookie headers
  const setCookieHeaders = [];
  
  // The built-in fetch stores headers differently
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === 'set-cookie') {
      setCookieHeaders.push(value);
    }
  });
  
  if (setCookieHeaders.length > 0) {
    debugLog(`Received ${setCookieHeaders.length} set-cookie headers:`, setCookieHeaders);
    setCookieHeaders.forEach(cookie => {
      const cookieName = cookie.split('=')[0];
      cookies = cookies.filter(c => !c.startsWith(`${cookieName}=`));
      cookies.push(cookie.split(';')[0]);
    });
    debugLog(`Updated cookies, now have ${cookies.length} cookies`);
  }
}

// Make fetch request with cookies
async function fetchWithCookies(url, options = {}) {
  const defaultOptions = {
    headers: {
      'Cookie': cookies.join('; '),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  };
  
  debugLog(`Making request to: ${url}`);
  debugLog(`Request options:`, { ...defaultOptions, ...options });
  
  const response = await fetch(url, { ...defaultOptions, ...options });
  updateCookies(response);
  
  debugLog(`Response status: ${response.status} ${response.statusText}`);
  debugLog(`Response headers:`, Object.fromEntries(response.headers.entries()));
  
  return response;
}

// Login to WordPress
async function login(username, password) {
  console.log('Logging in to WordPress...');
  const loginUrl = 'https://midtown.pcrs.ca/wp-login.php';
  
  debugLog(`Starting login process for user: ${username}`);
  
  // Get login page to capture initial cookies
  let response = await fetch(loginUrl);
  updateCookies(response);
  saveCookiesDebug('initial-login-page');
  
  // Parse login page to get any security tokens
  const html = await response.text();
  saveDebugFile('login-page.html', html, 'initial login page');
  
  const dom = new JSDOM(html);
  const nonceInput = dom.window.document.querySelector('input[name="_wpnonce"]');
  
  debugLog('Login nonce found:', nonceInput ? nonceInput.value : 'none');
  
  // Prepare login form data
  const formData = new URLSearchParams();
  formData.append('log', username);
  formData.append('pwd', password);
  formData.append('wp-submit', 'Log In');
  formData.append('redirect_to', 'https://midtown.pcrs.ca/wp-admin/');
  
  if (nonceInput) {
    formData.append('_wpnonce', nonceInput.value);
  }
  
  debugLog('Login form data:', Object.fromEntries(formData.entries()));
  
  // Submit login form
  response = await fetchWithCookies(loginUrl, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  saveCookiesDebug('after-login-post');
  
  const loginResponseText = await response.text();
  saveDebugFile('login-response.html', loginResponseText, 'login response page');
  
  // Check if login was successful
  const responseUrl = response.url;
  debugLog(`Login response URL: ${responseUrl}`);
  
  if (responseUrl.includes('wp-admin')) {
    console.log('Login successful');
    debugLog('Login successful - redirected to wp-admin');
    return true;
  } else {
    console.log('Login failed');
    debugLog('Login failed - not redirected to wp-admin');
    
    // Look for error messages in the response
    const errorDom = new JSDOM(loginResponseText);
    const errorElement = errorDom.window.document.querySelector('#login_error, .login-error, .error');
    if (errorElement) {
      debugLog('Login error message found:', errorElement.textContent.trim());
    }
    
    return false;
  }
}

// Prompt user to select workshop type
async function promptWorkshopType() {
  debugLog('Prompting user to select workshop type');
  
  const answer = await prompt([
    {
      type: 'list',
      name: 'workshopType',
      message: 'Select the type of workshop to export:',
      choices: workshopTypes
    }
  ]);
  
  debugLog(`User selected workshop type: ${answer.workshopType}`);
  return answer.workshopType;
}

// Find workshop events from calendar page
async function findWorkshopEvents(calendarUrl, workshopType) {
  console.log(`Searching for "${workshopType}" workshop events on: ${calendarUrl}`);
  const response = await fetchWithCookies(calendarUrl);
  const html = await response.text();
  
  saveDebugFile('calendar-page.html', html, 'calendar page HTML');
  
  const dom = new JSDOM(html);
  
  // Get current date for comparison
  const currentDate = new Date();
  debugLog(`Current date for filtering: ${currentDate.toISOString()}`);
  
  // Map workshop types to search terms
  const searchTerms = {
    'Basic Life': ['basic life', 'life skills'],
    'Essential Work': ['essential work', 'work essential'],
    'Career Planning': ['career planning', 'career exploration'],
    'Resume': ['resume'],
    'Interview': ['interview', 'interviewing skills'],
    'Networking': ['network', 'networking'],
    'Education': ['education', 'educational']
  };
  
  // Get the search terms for the selected workshop type
  const terms = searchTerms[workshopType] || [workshopType.toLowerCase()];
  debugLog(`Search terms for "${workshopType}":`, terms);
  
  // Function to check if any term is found in the text
  const hasMatchingTerm = (text) => {
    const lowerText = text.toLowerCase();
    const matches = terms.filter(term => lowerText.includes(term));
    if (matches.length > 0) {
      debugLog(`Found matching terms in "${text}":`, matches);
    }
    return matches.length > 0;
  };
  
  // Get all events
  const events = [];
  
  // Look for events in various container structures (different themes may use different structures)
  const selectors = [
    '.tribe-events-calendar-list__event',
    '.tribe-events-calendar-month__calendar-event',
    'article.type-tribe_events'
  ];
  
  let eventContainers = [];
  selectors.forEach(selector => {
    const elements = dom.window.document.querySelectorAll(selector);
    debugLog(`Found ${elements.length} elements with selector: ${selector}`);
    eventContainers.push(...elements);
  });
  
  debugLog(`Total event containers found: ${eventContainers.length}`);
  
  for (const [index, container] of eventContainers.entries()) {
    debugLog(`Processing event container ${index + 1}/${eventContainers.length}`);
    
    let title = '';
    let link = '';
    let dateText = '';
    let eventDate = null;
    
    // Try to extract title and link
    const titleSelectors = [
      '.tribe-events-calendar-list__event-title a',
      '.tribe-events-calendar-month__calendar-event-title a',
      '.entry-title a'
    ];
    
    let titleElement = null;
    for (const selector of titleSelectors) {
      titleElement = container.querySelector(selector);
      if (titleElement) {
        debugLog(`Found title element with selector: ${selector}`);
        break;
      }
    }
    
    if (titleElement) {
      title = titleElement.textContent.trim();
      link = titleElement.href;
      debugLog(`Event title: "${title}"`);
      debugLog(`Event link: ${link}`);
    }
    
    // Skip if we couldn't find a title or if it doesn't match our search terms
    if (!title) {
      debugLog('No title found, skipping event');
      continue;
    }
    
    if (!hasMatchingTerm(title)) {
      debugLog(`Title "${title}" doesn't match search terms, skipping`);
      continue;
    }
    
    // Try to extract date - first check for time elements
    const timeElement = container.querySelector('time');
    if (timeElement) {
      const datetime = timeElement.getAttribute('datetime');
      if (datetime) {
        eventDate = new Date(datetime);
        debugLog(`Found datetime attribute: ${datetime} -> ${eventDate.toISOString()}`);
      } else {
        dateText = timeElement.textContent.trim();
        debugLog(`Found time element text: ${dateText}`);
      }
    }
    
    // If no time element, try other date containers
    if (!eventDate) {
      const dateSelectors = [
        '.tribe-events-calendar-list__event-date-tag',
        '.tribe-events-calendar-month__calendar-event-datetime'
      ];
      
      for (const selector of dateSelectors) {
        const dateElement = container.querySelector(selector);
        if (dateElement) {
          dateText = dateElement.textContent.trim();
          debugLog(`Found date element with selector ${selector}: ${dateText}`);
          break;
        }
      }
    }
    
    // Try to parse date from text if we have date text
    if (!eventDate && dateText) {
      // Handle common date formats
      const dateMatch = dateText.match(/([A-Za-z]+)\s+(\d+),?\s+(\d{4})/);
      if (dateMatch) {
        const [_, month, day, year] = dateMatch;
        eventDate = new Date(`${month} ${day}, ${year}`);
        debugLog(`Parsed date from text "${dateText}": ${eventDate.toISOString()}`);
      } else {
        // Try direct parsing as fallback
        eventDate = new Date(dateText);
        if (!isNaN(eventDate.getTime())) {
          debugLog(`Direct parsed date from text "${dateText}": ${eventDate.toISOString()}`);
        } else {
          debugLog(`Failed to parse date from text: ${dateText}`);
          eventDate = null;
        }
      }
    }
    
    // Make sure link is absolute
    if (link && !link.startsWith('http')) {
      const absoluteLink = new URL(link, calendarUrl).href;
      debugLog(`Converted relative link "${link}" to absolute: ${absoluteLink}`);
      link = absoluteLink;
    }
    
    // Add to events if we got a link
    if (link) {
      const event = {
        title,
        url: link,
        date: eventDate,
        dateText: eventDate ? eventDate.toLocaleDateString() : dateText || 'Unknown date'
      };
      events.push(event);
      debugLog(`Added event:`, event);
    } else {
      debugLog('No link found for event, skipping');
    }
  }
  
  // Save events debug info
  saveDebugFile('found-events.json', JSON.stringify(events, null, 2), 'all found events');
  
  // Filter out past events
  const futureEvents = events.filter(event => {
    if (!event.date) {
      // If we couldn't parse the date, include it to be safe
      debugLog(`Including event "${event.title}" (no date parsed)`);
      return true;
    }
    
    const isFuture = event.date >= currentDate;
    debugLog(`Event "${event.title}" (${event.date.toISOString()}) is ${isFuture ? 'future' : 'past'}`);
    return isFuture;
  });
  
  saveDebugFile('future-events.json', JSON.stringify(futureEvents, null, 2), 'filtered future events');
  
  console.log(`Found ${events.length} matching events, ${futureEvents.length} are in the future`);
  
  return futureEvents;
}

// Prompt user to select an event if multiple are found
async function selectEvent(events) {
  if (events.length === 0) {
    debugLog('No events to select from');
    return null;
  }
  
  if (events.length === 1) {
    debugLog(`Only one event found, auto-selecting: ${events[0].url}`);
    return events[0].url;
  }
  
  debugLog(`Multiple events found (${events.length}), prompting user to select`);
  
  // Sort events by date (if available)
  events.sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date - b.date;
  });
  
  const choices = events.map(event => ({
    name: `${event.title} (${event.dateText})`,
    value: event.url
  }));
  
  const answer = await prompt([
    {
      type: 'list',
      name: 'eventUrl',
      message: 'Multiple upcoming events found. Please select one:',
      choices
    }
  ]);
  
  debugLog(`User selected event: ${answer.eventUrl}`);
  return answer.eventUrl;
}

// Extract event ID from event page
async function getEventId(eventUrl) {
  console.log(`Getting event ID from: ${eventUrl}`);
  const response = await fetchWithCookies(eventUrl);
  const html = await response.text();
  
  saveDebugFile('event-page.html', html, 'event page HTML');
  
  // Multiple methods to extract the event ID
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  
  // Method 1: Check body class for postid
  const bodyClass = doc.body.className;
  debugLog(`Body classes: ${bodyClass}`);
  const postIdMatch = bodyClass.match(/\bpostid-(\d+)\b/);
  if (postIdMatch && postIdMatch[1]) {
    console.log(`Found event ID in body class: ${postIdMatch[1]}`);
    debugLog(`Event ID found via body class method`);
    return postIdMatch[1];
  }
  
  // Method 2: Look in data attributes
  const elements = doc.querySelectorAll('[data-event-id], [data-post-id]');
  debugLog(`Found ${elements.length} elements with data-event-id or data-post-id attributes`);
  for (const el of elements) {
    const id = el.getAttribute('data-event-id') || el.getAttribute('data-post-id');
    if (id) {
      console.log(`Found event ID in data attribute: ${id}`);
      debugLog(`Event ID found via data attribute method`);
      return id;
    }
  }
  
  // Method 3: Search in script tags
  const scriptMatch = html.match(/["']event_id["']\s*:\s*["']?(\d+)["']?/i);
  if (scriptMatch && scriptMatch[1]) {
    console.log(`Found event ID in script: ${scriptMatch[1]}`);
    debugLog(`Event ID found via script parsing method`);
    return scriptMatch[1];
  }
  
  // Method 4: Look for hidden inputs
  const hiddenInputs = doc.querySelectorAll('input[type="hidden"]');
  debugLog(`Found ${hiddenInputs.length} hidden input elements`);
  for (const input of hiddenInputs) {
    const name = input.getAttribute('name');
    const value = input.getAttribute('value');
    if (name && (name.includes('event') || name.includes('post')) && value && /^\d+$/.test(value)) {
      debugLog(`Potential event ID from hidden input ${name}: ${value}`);
    }
  }
  
  console.log('Could not find event ID');
  debugLog('All event ID extraction methods failed');
  return null;
}

// Access the attendees admin page
async function getAttendeesPage(eventId) {
  const attendeesUrl = `https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=${eventId}`;
  console.log(`Accessing attendees page: ${attendeesUrl}`);
  
  const response = await fetchWithCookies(attendeesUrl);
  const html = await response.text();
  
  saveDebugFile('attendees-page.html', html, 'attendees admin page');
  saveCookiesDebug('attendees-page-access');
  
  return html;
}

// Get the CSV export URL with nonce
async function getCsvExportUrl(attendeesHtml, eventId) {
  debugLog('Searching for CSV export nonce in attendees page');
  
  // Extract nonce from the page
  const nonceMatch = attendeesHtml.match(/attendees_csv_nonce=([a-z0-9]+)/i);
  if (!nonceMatch || !nonceMatch[1]) {
    console.log('Could not find attendees CSV nonce');
    debugLog('CSV nonce not found in page HTML');
    
    // Save additional debug info
    const dom = new JSDOM(attendeesHtml);
    const links = dom.window.document.querySelectorAll('a[href*="csv"]');
    debugLog(`Found ${links.length} links containing "csv":`);
    links.forEach((link, i) => {
      debugLog(`CSV Link ${i + 1}: ${link.href}`);
    });
    
    return null;
  }
  
  const nonce = nonceMatch[1];
  const exportUrl = `https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=${eventId}&attendees_csv=1&attendees_csv_nonce=${nonce}`;
  
  console.log(`Found CSV export URL with nonce: ${exportUrl}`);
  debugLog(`CSV nonce found: ${nonce}`);
  
  saveDebugFile('csv-export-url.txt', exportUrl, 'CSV export URL');
  
  return exportUrl;
}

// Download and save the CSV
async function downloadAttendeesCsv(exportUrl, workshopType) {
  console.log('Downloading attendees CSV...');
  debugLog(`Making request to CSV export URL: ${exportUrl}`);
  
  const response = await fetchWithCookies(exportUrl);
  const csvData = await response.text();
  
  debugLog(`CSV response status: ${response.status}`);
  debugLog(`CSV data length: ${csvData.length} characters`);
  debugLog(`CSV data preview (first 500 chars): ${csvData.substring(0, 500)}`);
  
  saveDebugFile('raw-attendees.csv', csvData, 'raw CSV export data');
  
  // Create sanitized filename from workshop type
  const sanitizedType = workshopType.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const downloadDir = path.join(process.env.USERPROFILE, 'Downloads');
  const filename = `${sanitizedType}-attendees-${new Date().toISOString().slice(0, 10)}.csv`;
  const fullPath = path.join(downloadDir, filename);
  
  fs.writeFileSync(fullPath, csvData);
  
  console.log(`Saved attendees list to: ${fullPath}`);
  debugLog(`Final CSV file saved with ${csvData.split('\n').length} lines`);
  
  return fullPath;
}

// Main function to export attendees
async function exportAttendees(username, password) {
  try {
    console.log(`Starting export process as user: ${username}`);
    debugLog(`Debug mode enabled, files will be saved to: ${DEBUG_DIR}`);
    
    // Step 1: Login
    const loggedIn = await login(username, password);
    if (!loggedIn) {
      throw new Error('Login failed. Check your credentials.');
    }
    
    // Step 2: Prompt for workshop type
    const workshopType = await promptWorkshopType();
    
    // Step 3: Find events
    const calendarUrl = 'https://midtown.pcrs.ca/calendar/';
    const events = await findWorkshopEvents(calendarUrl, workshopType);
    
    if (events.length === 0) {
      throw new Error(`No upcoming "${workshopType}" events found.`);
    }
    
    // Step 4: Let user select an event if multiple found
    const eventUrl = await selectEvent(events);
    
    if (!eventUrl) {
      throw new Error('No event selected.');
    }
    
    // Step 5: Get event ID
    const eventId = await getEventId(eventUrl);
    if (!eventId) {
      throw new Error('Could not determine event ID.');
    }
    
    // Step 6: Get attendees page
    const attendeesHtml = await getAttendeesPage(eventId);
    
    // Step 7: Get export URL with nonce
    const exportUrl = await getCsvExportUrl(attendeesHtml, eventId);
    if (!exportUrl) {
      throw new Error('Could not get CSV export URL.');
    }
    
    // Step 8: Download attendees CSV
    const csvFilename = await downloadAttendeesCsv(exportUrl, workshopType);
    
    console.log(`Successfully exported attendees list to: ${csvFilename}`);
    
    if (DEBUG_MODE) {
      console.log(`Debug files saved to: ${DEBUG_DIR}`);
    }
    
    return true;
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    debugLog('Full error details:', error);
    return false;
  }
}

// Main entry point - no hardcoded credentials
async function main() {
  // Show usage info if debug mode is enabled
  if (DEBUG_MODE) {
    console.log('Debug mode enabled - intermediary files will be saved');
  }
  
  try {
    // Get credentials securely
    const creds = await getCredentials();
    
    // Run the export with the credentials
    const success = await exportAttendees(creds.username, creds.password);
    
    // Exit with appropriate code
    process.exit(success ? 0 : 1);
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
    debugLog('Main function error details:', error);
    process.exit(1);
  }
}

// Start the program
main();