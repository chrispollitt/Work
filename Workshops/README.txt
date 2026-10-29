powershell -File attendee_list.ps1
node export-attendees.js --debug 

Here is the current output. A few notes:

We should fix the deprecated code
Can the calling PowerShell script catch an early exit of the node script?
If the event is not found the node script should have a way to let the calling PowerShell script know

---

It failed to find the Career Planning event (see attached html)
If not found, it should check the next month

==========

perl -lpe 's,<script>.*?</script>,,g; s,<style>.*?</style>,,g; s,<[^>]*>,,g' *login-response.html

perl -lpe 's,<script>.*?</script>,,g; s,<style>.*?</style>,,g; s,<[^>]*>,,g' *calendar-page.html

Just a moment...Enable JavaScript and cookies to continue
