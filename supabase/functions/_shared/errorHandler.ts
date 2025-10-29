/**
 * Sanitizes error messages before sending to clients
 * Prevents information disclosure while keeping server-side logging
 */

interface ErrorResponse {
  error: string;
  code?: string;
}

const errorMessageMap: Record<string, string> = {
  // Database errors
  'duplicate key': 'This record already exists',
  'violates foreign key': 'Invalid reference to related data',
  'violates not-null': 'Required field is missing',
  'violates unique': 'This value must be unique',
  'permission denied': 'You do not have permission to perform this action',
  
  // Auth errors
  'invalid jwt': 'Authentication failed',
  'jwt expired': 'Your session has expired',
  'user not found': 'Authentication failed',
  
  // Generic patterns
  'constraint': 'Operation failed due to data validation',
  'syntax error': 'Invalid request format',
  'relation': 'Database operation failed',
};

/**
 * Sanitizes error messages for client consumption
 * @param error - The error object or message
 * @param genericMessage - Default message if no specific mapping found
 * @returns Sanitized error message safe for client display
 */
export function sanitizeError(
  error: Error | string | unknown,
  genericMessage = 'An error occurred while processing your request'
): ErrorResponse {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // Log the detailed error server-side
  console.error('Detailed error:', errorMessage);
  
  // Check for specific error patterns and return generic messages
  const lowerMessage = errorMessage.toLowerCase();
  for (const [pattern, clientMessage] of Object.entries(errorMessageMap)) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return { error: clientMessage };
    }
  }
  
  // Return generic message for unknown errors
  return { error: genericMessage };
}

/**
 * Creates a standardized error Response object
 */
export function createErrorResponse(
  error: Error | string | unknown,
  status = 500,
  corsHeaders: Record<string, string>,
  genericMessage?: string
): Response {
  const sanitized = sanitizeError(error, genericMessage);
  
  return new Response(
    JSON.stringify(sanitized),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  );
}
