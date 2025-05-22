# I want to use npm's jsdom to interact with a WordPress site that uses these WP plugins for a workshop calendar site:
# 
# * The Events Calendar
# * Event Tickets Plus
# 
# Sadly, we must assume the WP web-APIs have been disabled.
# 
# Let's assume I'm a WP-Admin and have access to the Attendee's list and want to export it.
# Here is an example sequence of URLs to scrape and then follow. 
# In this case I want the next interview-skills workshop participant list:
# 
# * https://midtown.pcrs.ca/calendar/
# * https://midtown.pcrs.ca/event/job-search-day-3-interview-skills-east-24/
# * https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=27068
# * https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=27068&attendees_csv=1&attendees_csv_nonce=87237473d0
# 
# We need to scrape the subsequent URLs as only the fist is stable.
# 
# npm install jsdom node-fetch inquirer
# node export-attendees.js

const workshopTypes = [
  'Basic Life',
  'Essential Work',
  'Career Planning',
  'Resume',
  'Interview',
  'Networking',
  'Education'
];

const { JSDOM } = require('jsdom');
const fetch = require('node-fetch');
const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');

// Store cookies for authenticated requests
let cookies = [];

// Update cookies from response
function updateCookies(response) {
  const setCookies = response.headers.raw()['set-cookie'];
  if (setCookies) {
    setCookies.forEach(cookie => {
      const cookieName = cookie.split('=')[0];
      cookies = cookies.filter(c => !c.startsWith(`${cookieName}=`));
      cookies.push(cookie.split(';')[0]);
    });
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
  
  const response = await fetch(url, { ...defaultOptions, ...options });
  updateCookies(response);
  return response;
}

// Login to WordPress
async function login(username, password) {
  console.log('Logging in to WordPress...');
  const loginUrl = 'https://midtown.pcrs.ca/wp-login.php';
  
  // Get login page to capture initial cookies
  let response = await fetch(loginUrl);
  updateCookies(response);
  
  // Parse login page to get any security tokens
  const html = await response.text();
  const dom = new JSDOM(html);
  const nonceInput = dom.window.document.querySelector('input[name="_wpnonce"]');
  
  // Prepare login form data
  const formData = new URLSearchParams();
  formData.append('log', username);
  formData.append('pwd', password);
  formData.append('wp-submit', 'Log In');
  formData.append('redirect_to', 'https://midtown.pcrs.ca/wp-admin/');
  
  if (nonceInput) {
    formData.append('_wpnonce', nonceInput.value);
  }
  
  // Submit login form
  response = await fetchWithCookies(loginUrl, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  // Check if login was successful
  const responseUrl = response.url;
  if (responseUrl.includes('wp-admin')) {
    console.log('Login successful');
    return true;
  } else {
    console.log('Login failed');
    return false;
  }
}

// Prompt user to select workshop type
async function promptWorkshopType() {
  
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'workshopType',
      message: 'Select the type of workshop to export:',
      choices: workshopTypes
    }
  ]);
  
  return answer.workshopType;
}

// Find workshop events from calendar page
async function findWorkshopEvents(calendarUrl, workshopType) {
  console.log(`Searching for "${workshopType}" workshop events on: ${calendarUrl}`);
  const response = await fetchWithCookies(calendarUrl);
  const html = await response.text();
  const dom = new JSDOM(html);
  
  // Get current date for comparison
  const currentDate = new Date();
  
  // Map workshop types to search terms
  const searchTerms = {
    'Basic Life': ['basic life', 'life skills'],
    'Essential Work': ['essential work', 'work essential'],
    'Career Planning': ['career planning', 'plan your career'],
    'Resume': ['resume', 'cv', 'curriculum vitae'],
    'Interviews': ['interview', 'interviewing skills'],
    'Networking': ['network', 'networking'],
    'Education': ['education', 'educational']
  };
  
  // Get the search terms for the selected workshop type
  const terms = searchTerms[workshopType] || [workshopType.toLowerCase()];
  
  // Function to check if any term is found in the text
  const hasMatchingTerm = (text) => {
    const lowerText = text.toLowerCase();
    return terms.some(term => lowerText.includes(term));
  };
  
  // Get all events
  const events = [];
  
  // Look for events in various container structures (different themes may use different structures)
  const eventContainers = [
    ...dom.window.document.querySelectorAll('.tribe-events-calendar-list__event'),
    ...dom.window.document.querySelectorAll('.tribe-events-calendar-month__calendar-event'),
    ...dom.window.document.querySelectorAll('article.type-tribe_events')
  ];
  
  for (const container of eventContainers) {
    let title = '';
    let link = '';
    let dateText = '';
    let eventDate = null;
    
    // Try to extract title and link
    const titleElement = container.querySelector('.tribe-events-calendar-list__event-title a, .tribe-events-calendar-month__calendar-event-title a, .entry-title a');
    if (titleElement) {
      title = titleElement.textContent.trim();
      link = titleElement.href;
    }
    
    // Skip if we couldn't find a title or if it doesn't match our search terms
    if (!title || !hasMatchingTerm(title)) continue;
    
    // Try to extract date - first check for time elements
    const timeElement = container.querySelector('time');
    if (timeElement) {
      const datetime = timeElement.getAttribute('datetime');
      if (datetime) {
        eventDate = new Date(datetime);
      } else {
        dateText = timeElement.textContent.trim();
      }
    }
    
    // If no time element, try other date containers
    if (!eventDate) {
      const dateElement = container.querySelector('.tribe-events-calendar-list__event-date-tag, .tribe-events-calendar-month__calendar-event-datetime');
      if (dateElement) {
        dateText = dateElement.textContent.trim();
      }
    }
    
    // Try to parse date from text if we have date text
    if (!eventDate && dateText) {
      // Handle common date formats
      const dateMatch = dateText.match(/([A-Za-z]+)\s+(\d+),?\s+(\d{4})/);
      if (dateMatch) {
        const [_, month, day, year] = dateMatch;
        eventDate = new Date(`${month} ${day}, ${year}`);
      } else {
        // Try direct parsing as fallback
        eventDate = new Date(dateText);
      }
    }
    
    // Make sure link is absolute
    if (link && !link.startsWith('http')) {
      link = new URL(link, calendarUrl).href;
    }
    
    // Add to events if we got a link
    if (link) {
      events.push({
        title,
        url: link,
        date: eventDate,
        dateText: eventDate ? eventDate.toLocaleDateString() : dateText || 'Unknown date'
      });
    }
  }
  
  // Filter out past events
  const futureEvents = events.filter(event => {
    if (!event.date) {
      // If we couldn't parse the date, include it to be safe
      return true;
    }
    
    return event.date >= currentDate;
  });
  
  console.log(`Found ${events.length} matching events, ${futureEvents.length} are in the future`);
  
  return futureEvents;
}

// Prompt user to select an event if multiple are found
async function selectEvent(events) {
  if (events.length === 0) {
    return null;
  }
  
  if (events.length === 1) {
    return events[0].url;
  }
  
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
  
  const answer = await inquirer.prompt([
    {
      type: 'list',
      name: 'eventUrl',
      message: 'Multiple upcoming events found. Please select one:',
      choices
    }
  ]);
  
  return answer.eventUrl;
}

// Extract event ID from event page
async function getEventId(eventUrl) {
  console.log(`Getting event ID from: ${eventUrl}`);
  const response = await fetchWithCookies(eventUrl);
  const html = await response.text();
  
  // Multiple methods to extract the event ID
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  
  // Method 1: Check body class for postid
  const bodyClass = doc.body.className;
  const postIdMatch = bodyClass.match(/\bpostid-(\d+)\b/);
  if (postIdMatch && postIdMatch[1]) {
    console.log(`Found event ID in body class: ${postIdMatch[1]}`);
    return postIdMatch[1];
  }
  
  // Method 2: Look in data attributes
  const elements = doc.querySelectorAll('[data-event-id], [data-post-id]');
  for (const el of elements) {
    const id = el.getAttribute('data-event-id') || el.getAttribute('data-post-id');
    if (id) {
      console.log(`Found event ID in data attribute: ${id}`);
      return id;
    }
  }
  
  // Method 3: Search in script tags
  const scriptMatch = html.match(/["']event_id["']\s*:\s*["']?(\d+)["']?/i);
  if (scriptMatch && scriptMatch[1]) {
    console.log(`Found event ID in script: ${scriptMatch[1]}`);
    return scriptMatch[1];
  }
  
  console.log('Could not find event ID');
  return null;
}

// Access the attendees admin page
async function getAttendeesPage(eventId) {
  const attendeesUrl = `https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=${eventId}`;
  console.log(`Accessing attendees page: ${attendeesUrl}`);
  
  const response = await fetchWithCookies(attendeesUrl);
  return await response.text();
}

// Get the CSV export URL with nonce
async function getCsvExportUrl(attendeesHtml, eventId) {
  // Extract nonce from the page
  const nonceMatch = attendeesHtml.match(/attendees_csv_nonce=([a-z0-9]+)/i);
  if (!nonceMatch || !nonceMatch[1]) {
    console.log('Could not find attendees CSV nonce');
    return null;
  }
  
  const nonce = nonceMatch[1];
  const exportUrl = `https://midtown.pcrs.ca/wp-admin/edit.php?post_type=tribe_events&page=tickets-attendees&event_id=${eventId}&attendees_csv=1&attendees_csv_nonce=${nonce}`;
  
  console.log(`Found CSV export URL with nonce: ${exportUrl}`);
  return exportUrl;
}

// Download and save the CSV
async function downloadAttendeesCsv(exportUrl, workshopType) {
  console.log('Downloading attendees CSV...');
  const response = await fetchWithCookies(exportUrl);
  const csvData = await response.text();
  
  // Create sanitized filename from workshop type
  const sanitizedType = workshopType.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const downloadDir = path.join(process.env.USERPROFILE, 'Downloads');
  const filename = `${sanitizedType}-attendees-${new Date().toISOString().slice(0, 10)}.csv`;
  const fullPath = path.join(downloadDir, filename);
  
  fs.writeFileSync(fullPath, csvData);
  
  console.log(`Saved attendees list to: ${fullPath}`);
  return fullPath;
}

// Main function to export attendees
async function exportAttendees(username, password) {
  try {
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
    
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}

// Replace with your WordPress admin credentials
const username = 'your-wp-admin-username';
const password = 'your-wp-admin-password';

// Run the export
exportAttendees(username, password);