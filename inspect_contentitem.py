from bosesoundtouchapi.models import ContentItem
import inspect

print("ContentItem __init__ signature:")
print(inspect.signature(ContentItem.__init__))

print("\nContentItem properties:")
print([p for p in dir(ContentItem) if isinstance(getattr(ContentItem, p), property)])

print("\nContentItem help:")
help(ContentItem)
