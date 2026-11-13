# Coding standards

## Settlement deadlines

When reviewing a settlement or oracle callback deadline, identify the authoritative clock and when its deadline starts. Check how callers interpret that deadline, including clock differences, network delays, expiry and delayed callbacks. Require tests or evidence for the intended boundary behavior; if separate clocks are intentional, document the resulting behavior and its limits. The scratch diagnostic's local and block-time clocks are described in the README; they do not establish a production settlement deadline.
