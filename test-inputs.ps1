# LUCY App Test Suite - 30 Different Inputs
# This script tests various input scenarios

$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
$package = "com.anonymous.lucy"
$activity = "$package/.MainActivity"

# Test data - 30 different inputs covering various scenarios
$testInputs = @(
    # 1-5: Simple tasks
    @{ num = 1; text = "Buy groceries tomorrow"; category = "Task" },
    @{ num = 2; text = "Call mom at 3 PM"; category = "Task with time" },
    @{ num = 3; text = "Fix the kitchen sink"; category = "Home task" },
    @{ num = 4; text = "Schedule dentist appointment"; category = "Appointment" },
    @{ num = 5; text = "Pay electricity bill by month end"; category = "Task with deadline" },
    
    # 6-10: Expenses
    @{ num = 6; text = "Spent 50 dollars on gas"; category = "Expense" },
    @{ num = 7; text = "Lunch cost me $15.50"; category = "Expense with amount" },
    @{ num = 8; text = "Monthly gym membership 45 rupees"; category = "Recurring expense" },
    @{ num = 9; text = "Bought laptop for 999 dollars"; category = "Large purchase" },
    @{ num = 10; text = "Coffee 3 dollars and muffin 2.50"; category = "Multiple expenses" },
    
    # 11-15: Ideas and notes
    @{ num = 11; text = "Build a mobile app for tracking personal finances"; category = "Startup idea" },
    @{ num = 12; text = "Write blog post about productivity tips"; category = "Content idea" },
    @{ num = 13; text = "Learn TypeScript and improve React skills"; category = "Learning goal" },
    @{ num = 14; text = "Home gym setup with dumbbells and yoga mat"; category = "Project idea" },
    @{ num = 15; text = "Create video tutorial for web development"; category = "Creative idea" },
    
    # 16-20: Reminders with dates
    @{ num = 16; text = "Remind me on May 26 2026 at 10:00 AM to start the project"; category = "Reminder with date" },
    @{ num = 17; text = "Meeting on May 28 2026 at 2:30 PM with the team"; category = "Meeting reminder" },
    @{ num = 18; text = "Birthday gift shopping on May 30 2026 at 6 PM"; category = "Event reminder" },
    @{ num = 19; text = "Follow up email to client tomorrow at 9 AM"; category = "Tomorrow reminder" },
    @{ num = 20; text = "Take medication at 8 AM and 8 PM daily"; category = "Recurring reminder" },
    
    # 21-25: Mixed and complex content
    @{ num = 21; text = "John from sales mentioned we need to update the CRM by June. Cost estimate is 5000."; category = "Mixed content" },
    @{ num = 22; text = "Visited the new cafe in downtown. Great coffee for 4 dollars. Meet Sarah there next week."; category = "Place + expense + person" },
    @{ num = 23; text = "Mom's birthday on June 5th. Need to buy gift and book restaurant. Budget 100 dollars."; category = "Event planning" },
    @{ num = 24; text = "Project deadline is June 15. Team meeting on June 10 at 3 PM. Estimate 40 hours of work."; category = "Project timeline" },
    @{ num = 25; text = "Invested 1000 in mutual funds. Target return 15%. Review on June 30."; category = "Financial planning" },
    
    # 26-30: Edge cases and special content
    @{ num = 26; text = "Naku chala ishtam Indian food. Sambar 150 rupees, Dosa 80. Next week cinema untundi Krish."; category = "Tanglish (Telugu-English)" },
    @{ num = 27; text = "TODO: Update README.md, fix bug #234, deploy to prod"; category = "Developer notes" },
    @{ num = 28; text = "!!!URGENT!!! Submit tax returns before May 31. Documents: pancard, aadhaar, bank statements."; category = "Urgent with sensitive data" },
    @{ num = 29; text = "Research: blockchain, AI, quantum computing. Articles: link1, link2, link3. Read by EOW."; category = "Research plan" },
    @{ num = 30; text = "Gym: 5km run, 20 pushups, 30 situps, 15 pullups. Breakfast: eggs, oats, banana, protein shake."; category = "Health and fitness" }
)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "LUCY APP - COMPREHENSIVE TEST SUITE" -ForegroundColor Cyan
Write-Host "Testing 30 different input scenarios" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Send each test input
foreach ($test in $testInputs) {
    $num = $test.num
    $text = $test.text
    $category = $test.category
    
    Write-Host "[$num/30] Testing: $category" -ForegroundColor Yellow
    Write-Host "  Input: $text" -ForegroundColor Gray
    
    # Send via Android share intent
    $intent = "am start -W -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '$text' -n $activity"
    & $adb shell $intent | Out-Null
    
    # Wait between inputs for processing
    Start-Sleep -Seconds 1.5
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "All 30 test inputs sent successfully!" -ForegroundColor Green
Write-Host "Check the app UI to validate captures" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
