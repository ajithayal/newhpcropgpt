from fastapi import HTTPException, status

class AYALHPCException(Exception):
    """Base exception for AYAL HPC."""
    def __init__(self, message: str, status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR):
        super().__init__(message)
        self.message = message
        self.status_code = status_code

AjiCoreException = AYALHPCException


class NodeOfflineError(AYALHPCException):
    def __init__(self, host: str):
        super().__init__(f"Target host '{host}' is offline or unreachable.", status.HTTP_503_SERVICE_UNAVAILABLE)
        self.host = host

class RemoteExecutionError(AYALHPCException):
    def __init__(self, host: str, command: str, exit_code: int, stderr: str):
        msg = f"Remote execution failed on {host} (exit {exit_code}): {stderr.strip() or 'Unknown error'}"
        super().__init__(msg, status.HTTP_502_BAD_GATEWAY)
        self.host = host
        self.command = command
        self.exit_code = exit_code
        self.stderr = stderr

class VerificationError(AYALHPCException):
    def __init__(self, resource: str, reason: str):
        super().__init__(f"Post-apply verification failed for {resource}: {reason}", status.HTTP_422_UNPROCESSABLE_ENTITY)
