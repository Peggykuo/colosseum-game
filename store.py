AGENT_REGISTRY = {}

# define decorator for registering game agents
def register_agent(agent_name=""):
    def decorator(func):
        AGENT_REGISTRY[agent_name] = func
        return func

    return decorator
